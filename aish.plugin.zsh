# aish.plugin.zsh - AI Shell Integration for Zsh
# Source this file in your .zshrc: source /path/to/aish.plugin.zsh

# Configuration (can be overridden before sourcing)
: ${AISH_BACKEND:=auto}          # auto, claude-code, api
: ${AISH_MODEL:=sonnet}          # sonnet, opus, haiku
: ${AISH_DEBUG:=false}           # Show debug output
: ${AISH_DATA_DIR:=${XDG_DATA_HOME:-$HOME/.local/share}/aish}  # Data directory
: ${AISH_HIGHLIGHTER:=auto}    # auto, bat, batcat, none, or path

# Session state (per-shell, not persisted)
_aish_session_id=""
_aish_session_started=false

# Directory where this plugin lives
AISH_DIR="${0:A:h}"

# ============================================================================
# Internal helpers
# ============================================================================

_aish_debug() {
  [[ "$AISH_DEBUG" == "true" ]] && print -P "%F{240}[aish] $*%f" >&2
}

_aish_error() {
  print -P "%F{red}[aish] $*%f" >&2
}

# Convert path to safe directory name (like Claude does)
_aish_path_to_dirname() {
  local path="$1"
  # Replace / with - to match Claude's format (pure zsh)
  echo "${path//\//-}"
}

# Get Claude config directory for aish
_aish_claude_config_dir() {
  echo "${AISH_DATA_DIR}/claude"
}

# Ensure Claude config is set up with credentials symlinked
_aish_ensure_claude_config() {
  local aish_claude_dir=$(_aish_claude_config_dir)
  local creds_file="${aish_claude_dir}/.credentials.json"

  # Create directory if needed
  [[ -d "$aish_claude_dir" ]] || mkdir -p "$aish_claude_dir" 2>/dev/null

  # Symlink credentials if not present
  if [[ ! -e "$creds_file" ]] && [[ -f "$HOME/.claude/.credentials.json" ]]; then
    ln -sf "$HOME/.claude/.credentials.json" "$creds_file" 2>/dev/null
    _aish_debug "Symlinked Claude credentials"
  fi
}

# Strip markdown code blocks from AI response
_aish_strip_markdown() {
  local text="$1"

  # Remove ```language\n...\n``` blocks
  if [[ "$text" =~ '```[a-zA-Z]*' ]]; then
    # Extract content between code fences
    text="${text#*\`\`\`}"       # Remove opening ```
    text="${text#*$'\n'}"        # Remove language identifier line
    text="${text%\`\`\`*}"       # Remove closing ```
  fi

  # Remove single backticks
  text="${text#\`}"
  text="${text%\`}"

  # Trim whitespace
  text="${text#"${text%%[![:space:]]*}"}"
  text="${text%"${text##*[![:space:]]}"}"

  echo "$text"
}

# Get errors directory, creating if needed
_aish_errors_dir() {
  local dir="$AISH_DATA_DIR/errors"
  [[ -d "$dir" ]] || mkdir -p "$dir" 2>/dev/null
  echo "$dir"
}

# Save an error record, returns the ID
_aish_save_error() {
  local cmd="$1"
  local exit_code="$2"
  local errors_dir=$(_aish_errors_dir)
  local counter_file="$errors_dir/counter"

  # Read and increment counter
  local id=1
  if [[ -f "$counter_file" ]]; then
    id=$(( $(cat "$counter_file") + 1 ))
  fi
  echo "$id" > "$counter_file"

  # Write error record (4 lines: command, exit_code, PWD, epoch)
  printf '%s\n%s\n%s\n%s\n' "$cmd" "$exit_code" "$PWD" "$(date +%s)" > "$errors_dir/$id"

  echo "$id"
}

# Load an error record by ID into _aish_err_* variables
_aish_load_error() {
  local id="$1"
  local file="$(_aish_errors_dir)/$id"

  [[ -f "$file" ]] || return 1

  {
    IFS= read -r _aish_err_cmd
    IFS= read -r _aish_err_code
    IFS= read -r _aish_err_dir
    IFS= read -r _aish_err_time
  } < "$file"
}

# Get the latest error ID from counter
_aish_latest_error_id() {
  local counter_file="$(_aish_errors_dir)/counter"
  [[ -f "$counter_file" ]] && cat "$counter_file"
}

# Format epoch as relative time
_aish_relative_time() {
  local epoch="$1"
  local now=$(date +%s)
  local diff=$(( now - epoch ))

  if (( diff < 60 )); then
    echo "${diff}s ago"
  elif (( diff < 3600 )); then
    echo "$(( diff / 60 ))m ago"
  elif (( diff < 86400 )); then
    echo "$(( diff / 3600 ))h ago"
  else
    echo "$(( diff / 86400 ))d ago"
  fi
}

# Resolve AISH_HIGHLIGHTER to an actual command
_aish_find_highlighter() {
  case "$AISH_HIGHLIGHTER" in
    auto|"")
      if command -v bat &>/dev/null; then
        echo bat
      elif command -v batcat &>/dev/null; then
        echo batcat
      fi
      ;;
    none)
      ;;
    *)
      echo "$AISH_HIGHLIGHTER"
      ;;
  esac
}

# Render AI output with syntax highlighting for code blocks
_aish_render_output() {
  local text="$1"
  local highlighter
  highlighter=$(_aish_find_highlighter)
  local in_code=false
  local lang=""
  local code_buf=""

  while IFS= read -r line; do
    if $in_code; then
      if [[ "$line" =~ '^```[[:space:]]*$' ]]; then
        if [[ -n "$highlighter" && -n "$lang" ]]; then
          printf '%s\n' "$code_buf" | "$highlighter" --color=always --style=plain --paging=never --language="$lang"
        else
          print -P -n "%F{yellow}"
          printf '%s\n' "$code_buf"
          print -P -n "%f"
        fi
        in_code=false
        lang=""
        code_buf=""
      else
        if [[ -n "$code_buf" ]]; then
          code_buf="$code_buf"$'\n'"$line"
        else
          code_buf="$line"
        fi
      fi
    else
      if [[ "$line" =~ '^```([a-zA-Z0-9_+-]*)' ]]; then
        lang="${match[1]}"
        in_code=true
        code_buf=""
      else
        print -P -n "%F{cyan}"
        print -r -- "$line"
        print -P -n "%f"
      fi
    fi
  done <<< "$text"

  # Handle unclosed code block
  if $in_code && [[ -n "$code_buf" ]]; then
    print -P -n "%F{yellow}"
    printf '%s\n' "$code_buf"
    print -P -n "%f"
  fi
}

# Detect which backend to use
_aish_detect_backend() {
  if [[ "$AISH_BACKEND" != "auto" ]]; then
    echo "$AISH_BACKEND"
    return
  fi

  # Prefer claude-code if available and no API key
  if command -v claude &>/dev/null && [[ -z "$ANTHROPIC_API_KEY" ]]; then
    echo "claude-code"
  elif [[ -n "$ANTHROPIC_API_KEY" ]]; then
    echo "api"
  elif command -v claude &>/dev/null; then
    echo "claude-code"
  else
    echo "none"
  fi
}

# Send prompt to AI and get response
_aish_query_ai() {
  local prompt="$1"
  local allow_tools="${2:-false}"  # Whether to allow Claude to use bash/tools
  local backend=$(_aish_detect_backend)

  _aish_debug "Backend: $backend"
  _aish_debug "Prompt: $prompt"

  case "$backend" in
    claude-code)
      local claude_config_dir=$(_aish_claude_config_dir)
      local result
      local -a claude_args

      _aish_ensure_claude_config
      claude_args=(-p "$prompt" --output-format text)

      if [[ "$allow_tools" != "true" ]]; then
        claude_args+=(--allowedTools '')
      fi

      # Generate session ID on first use
      if [[ -z "$_aish_session_id" ]]; then
        if command -v uuidgen &>/dev/null; then
          _aish_session_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
        elif [[ -f /proc/sys/kernel/random/uuid ]]; then
          _aish_session_id=$(cat /proc/sys/kernel/random/uuid)
        else
          _aish_session_id=$(od -x /dev/urandom | head -1 | awk '{print $2$3"-"$4"-"$5"-"$6"-"$7$8$9}')
        fi
      fi

      _aish_debug "Session ID: $_aish_session_id"
      _aish_debug "Claude config: $claude_config_dir"
      _aish_debug "Allow tools: $allow_tools"

      if [[ "$_aish_session_started" == "true" ]]; then
        _aish_debug "Resuming session"
        claude_args+=(--resume "$_aish_session_id")
      else
        _aish_debug "Starting new session"
        claude_args+=(--session-id "$_aish_session_id")
      fi

      result=$(CLAUDE_CONFIG_DIR="$claude_config_dir" claude "${claude_args[@]}" 2>/dev/null)

      if [[ -n "$result" ]]; then
        _aish_session_started=true
      fi

      echo "$result"
      ;;
    api)
      # Direct API call using curl
      local response
      response=$(curl -s https://api.anthropic.com/v1/messages \
        -H "Content-Type: application/json" \
        -H "x-api-key: $ANTHROPIC_API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d "{
          \"model\": \"claude-sonnet-4-20250514\",
          \"max_tokens\": 1024,
          \"messages\": [{\"role\": \"user\", \"content\": $(printf '%s' "$prompt" | jq -Rs .)}]
        }" 2>/dev/null)

      echo "$response" | jq -r '.content[0].text // empty' 2>/dev/null
      ;;
    *)
      _aish_error "No AI backend available. Install claude CLI or set ANTHROPIC_API_KEY"
      return 1
      ;;
  esac
}

# ============================================================================
# Main aish command
# ============================================================================

aish() {
  local cmd="${1:-help}"
  shift 2>/dev/null

  case "$cmd" in
    help|--help|-h)
      _aish_cmd_help
      ;;
    status|info)
      _aish_cmd_status
      ;;
    reset|clear)
      _aish_cmd_reset "$@"
      ;;
    compact)
      _aish_cmd_compact
      ;;
    config)
      _aish_cmd_config "$@"
      ;;
    debug)
      _aish_cmd_debug
      ;;
    errors)
      _aish_cmd_errors "$@"
      ;;
    fix)
      _aish_cmd_fix "$@"
      ;;
    explain)
      _aish_cmd_explain "$@"
      ;;
    *)
      _aish_error "Unknown command: $cmd"
      _aish_cmd_help
      return 1
      ;;
  esac
}

_aish_cmd_help() {
  print -P "%F{cyan}aish%f - AI Shell Integration"
  print ""
  print -P "%F{yellow}Keybindings:%f"
  print "  Alt+J            Generate command (or fix last error if blank)"
  print "  Alt+K            Ask question (or explain last error if blank)"
  print ""
  print -P "%F{yellow}Commands:%f"
  print "  aish <command>   Manage aish"
  print ""
  print -P "%F{yellow}Management:%f"
  print "  status           Show current session info and backend status"
  print "  reset [--all]    Reset session for current dir (--all for all sessions)"
  print "  compact          Compact/summarize current session to reduce context"
  print "  config [key=val] Show or set configuration"
  print "  debug            Toggle debug mode"
  print "  help             Show this help"
  print ""
  print -P "%F{yellow}Errors:%f"
  print "  errors           List recorded errors"
  print "  errors <id>      View error details"
  print "  errors rm <id>   Remove an error record"
  print "  errors clear     Remove all error records"
  print "  fix [id]         Generate fix for error (default: latest)"
  print "  explain [id]     Explain error (default: latest)"
  print ""
  print -P "%F{yellow}Configuration:%f"
  print "  AISH_BACKEND     auto, claude-code, api (current: $AISH_BACKEND)"
  print "  AISH_MODEL       sonnet, opus, haiku (current: $AISH_MODEL)"
  print "  AISH_DEBUG       true/false (current: $AISH_DEBUG)"
  print "  AISH_HIGHLIGHTER auto, bat, batcat, none (current: $AISH_HIGHLIGHTER)"
  print "  AISH_DATA_DIR    Data directory"
}

_aish_cmd_status() {
  local claude_config_dir=$(_aish_claude_config_dir)
  local backend=$(_aish_detect_backend)

  print -P "%F{cyan}aish status%f"
  print ""
  print -P "%F{yellow}Session:%f"
  if [[ -n "$_aish_session_id" ]]; then
    print "  Session ID:   $_aish_session_id"
    print "  Active:       $([[ "$_aish_session_started" == "true" ]] && echo "yes" || echo "no")"
  else
    print "  Session ID:   (none)"
  fi
  print ""
  print -P "%F{yellow}Backend:%f"
  print "  Type:         $backend"

  if [[ "$backend" == "claude-code" && -n "$_aish_session_id" ]]; then
    local session_file="${claude_config_dir}/projects/$(_aish_path_to_dirname "$PWD")/${_aish_session_id}.jsonl"
    if [[ -f "$session_file" ]]; then
      local line_count=$(wc -l < "$session_file" 2>/dev/null || echo "0")
      local file_size=$(du -h "$session_file" 2>/dev/null | cut -f1 || echo "unknown")
      print "  Session file: $session_file"
      print "  Messages:     ~$((line_count / 2))"
      print "  Size:         $file_size"
    fi
  fi

  print ""
  print -P "%F{yellow}Errors:%f"
  local error_count=0
  local errors_dir=$(_aish_errors_dir)
  if [[ -f "$errors_dir/counter" ]]; then
    local max_id=$(cat "$errors_dir/counter")
    for id in $(seq 1 "$max_id"); do
      [[ -f "$errors_dir/$id" ]] && (( error_count++ ))
    done
  fi
  print "  Recorded:     $error_count"

  print ""
  print -P "%F{yellow}Configuration:%f"
  print "  Data dir:     $AISH_DATA_DIR"
  print "  Claude dir:   $claude_config_dir"
  print "  Debug:        $AISH_DEBUG"
}

_aish_cmd_reset() {
  local all=false
  [[ "$1" == "--all" || "$1" == "-a" ]] && all=true

  _aish_session_id=""
  _aish_session_started=false

  if $all; then
    print -P "%F{yellow}Delete all stored session data? [y/N]%f"
    read -k1 confirm
    echo
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
      rm -rf "${AISH_DATA_DIR}/sessions" "${AISH_DATA_DIR}/claude/projects"
      print -P "%F{green}Session reset, stored data cleared%f"
    else
      print -P "%F{green}Session reset%f"
    fi
  else
    print -P "%F{green}Session reset%f"
  fi
}

_aish_cmd_compact() {
  if [[ "$(_aish_detect_backend)" != "claude-code" ]]; then
    _aish_error "Compact only available with claude-code backend"
    return 1
  fi

  if [[ "$_aish_session_started" != "true" ]]; then
    print -P "%F{yellow}No active session to compact%f"
    return 1
  fi

  print -P "%F{cyan}Compacting session...%f"

  local summary
  summary=$(_aish_query_ai "Please provide a brief summary of our conversation so far, including any important context, decisions, or information I've shared. This will be used to continue our conversation with reduced context. Keep it concise but include key details.")

  if [[ -n "$summary" ]]; then
    _aish_session_id=""
    _aish_session_started=false

    _aish_query_ai "Here's a summary of our previous conversation for context: $summary

Please acknowledge you have this context and are ready to continue."

    print -P "%F{green}Session compacted successfully%f"
  else
    _aish_error "Failed to compact session"
    return 1
  fi
}

_aish_cmd_config() {
  local setting="$1"
  shift 2>/dev/null

  if [[ -z "$setting" ]]; then
    # Show current config
    print -P "%F{cyan}Current configuration:%f"
    print "  AISH_BACKEND=$AISH_BACKEND"
    print "  AISH_MODEL=$AISH_MODEL"
    print "  AISH_DEBUG=$AISH_DEBUG"
    print "  AISH_HIGHLIGHTER=$AISH_HIGHLIGHTER"
    print "  AISH_DATA_DIR=$AISH_DATA_DIR"
    return
  fi

  # Parse key=value
  local key="${setting%%=*}"
  local value="${setting#*=}"

  case "$key" in
    backend|AISH_BACKEND)
      AISH_BACKEND="$value"
      print -P "%F{green}AISH_BACKEND=$value%f"
      ;;
    model|AISH_MODEL)
      AISH_MODEL="$value"
      print -P "%F{green}AISH_MODEL=$value%f"
      ;;
    debug|AISH_DEBUG)
      AISH_DEBUG="$value"
      print -P "%F{green}AISH_DEBUG=$value%f"
      ;;
    highlighter|AISH_HIGHLIGHTER)
      AISH_HIGHLIGHTER="$value"
      print -P "%F{green}AISH_HIGHLIGHTER=$value%f"
      ;;
    *)
      _aish_error "Unknown config key: $key"
      return 1
      ;;
  esac
}

_aish_cmd_debug() {
  if [[ "$AISH_DEBUG" == "true" ]]; then
    AISH_DEBUG=false
    print -P "%F{240}Debug mode: off%f"
  else
    AISH_DEBUG=true
    print -P "%F{green}Debug mode: on%f"
  fi
}

_aish_cmd_errors() {
  local subcmd="$1"
  local arg="$2"
  local errors_dir=$(_aish_errors_dir)

  case "$subcmd" in
    rm)
      if [[ -z "$arg" ]]; then
        _aish_error "Usage: aish errors rm <id>"
        return 1
      fi
      if [[ -f "$errors_dir/$arg" ]]; then
        rm -f "$errors_dir/$arg"
        print -P "%F{green}Removed error #$arg%f"
      else
        _aish_error "Error #$arg not found"
        return 1
      fi
      ;;
    clear)
      rm -f "$errors_dir"/[0-9]* "$errors_dir/counter" 2>/dev/null
      print -P "%F{green}All errors cleared%f"
      ;;
    "")
      # List all errors
      local counter_file="$errors_dir/counter"
      if [[ ! -f "$counter_file" ]]; then
        print -P "%F{yellow}No errors recorded%f"
        return
      fi
      local max_id=$(cat "$counter_file")
      local found=false
      for id in $(seq 1 "$max_id"); do
        [[ -f "$errors_dir/$id" ]] || continue
        found=true
        _aish_load_error "$id"
        local rel_time=$(_aish_relative_time "$_aish_err_time")
        local short_cmd="$_aish_err_cmd"
        (( ${#short_cmd} > 30 )) && short_cmd="${short_cmd:0:27}..."
        printf "  #%-3s  exit %-4s  %-30s  %-20s  %s\n" \
          "$id" "$_aish_err_code" "$short_cmd" "$_aish_err_dir" "$rel_time"
      done
      if ! $found; then
        print -P "%F{yellow}No errors recorded%f"
      fi
      ;;
    *)
      # View specific error by ID
      if [[ "$subcmd" =~ ^[0-9]+$ ]]; then
        if ! _aish_load_error "$subcmd"; then
          _aish_error "Error #$subcmd not found"
          return 1
        fi
        local timestamp
        timestamp=$(date -d "@$_aish_err_time" '+%Y-%m-%d %H:%M:%S' 2>/dev/null \
          || date -r "$_aish_err_time" '+%Y-%m-%d %H:%M:%S' 2>/dev/null \
          || echo "$_aish_err_time")
        print -P "%F{cyan}Error #$subcmd%f"
        print "  Command:   $_aish_err_cmd"
        print "  Exit code: $_aish_err_code"
        print "  Directory: $_aish_err_dir"
        print "  Time:      $timestamp"
      else
        _aish_error "Unknown errors subcommand: $subcmd"
        return 1
      fi
      ;;
  esac
}

_aish_cmd_fix() {
  local id="${1:-$(_aish_latest_error_id)}"
  if [[ -z "$id" ]]; then
    _aish_error "No errors recorded"
    return 1
  fi
  _aish_fix_error "$id"
}

_aish_cmd_explain() {
  local id="${1:-$(_aish_latest_error_id)}"
  if [[ -z "$id" ]]; then
    _aish_error "No errors recorded"
    return 1
  fi
  _aish_explain_error "$id"
}

aish-query() {
  local query="$*"

  # Interactive mode if no args provided - use vared for readline editing
  if [[ -z "$query" ]]; then
    local REPLY=""
    vared -c -h -p "%F{cyan}?%f " REPLY || return 0
    query="$REPLY"
    if [[ -z "$query" ]]; then
      return 0
    fi
  fi

  local prompt="Answer this question concisely. Be direct and helpful.
Current directory: $PWD
Shell: zsh

Question: $query"

  print -P "%F{cyan}Thinking...%f"

  local answer
  answer=$(_aish_query_ai "$prompt")

  if [[ -n "$answer" ]]; then
    # Clear the "Thinking..." line and print answer
    print -n "\033[1A\033[2K"
    _aish_render_output "$answer"
  else
    print -P "\033[1A\033[2K%F{red}Failed to get response%f"
    return 1
  fi
}

aish-generate() {
  local request="$*"

  # Interactive mode if no args provided - use vared for readline editing
  if [[ -z "$request" ]]; then
    local REPLY=""
    vared -c -h -p "%F{yellow}!%f " REPLY || return 0
    request="$REPLY"
    if [[ -z "$request" ]]; then
      return 0
    fi
  fi

  local prompt="Generate a shell command for zsh based on this request.
IMPORTANT: Output ONLY the command, nothing else. No explanation, no markdown, no code blocks.

Current directory: $PWD
Request: $request"

  print -P "%F{cyan}Generating...%f"

  local cmd
  cmd=$(_aish_query_ai "$prompt")

  if [[ -z "$cmd" ]]; then
    print -P "\033[1A\033[2K%F{red}Failed to generate command%f"
    return 1
  fi

  # Clean up command (remove any accidental markdown)
  cmd=$(_aish_strip_markdown "$cmd")

  # Clear "Generating..." and show command
  print -P "\033[1A\033[2K%F{yellow}$cmd%f"

  # Prompt for action
  print -Pn "%F{240}[e]xecute, [c]opy to prompt, [n]o? %f"
  read -k1 action
  echo

  case "$action" in
    e|E|y|Y)
      print -P "%F{green}Executing...%f"
      eval "$cmd"
      ;;
    c|C)
      # Output command for widget to capture, or use print -z as fallback
      if [[ -n "$AISH_COPY_TO_BUFFER" ]]; then
        # Widget mode - output to fd 3 for capture
        print -r -- "$cmd" >&3
      else
        # Direct invocation - use buffer stack (will appear after next command)
        print -z -- "$cmd"
      fi
      return 0
      ;;
    *)
      print -P "%F{240}Cancelled%f"
      ;;
  esac
}

# ============================================================================
# Error fix and explain
# ============================================================================

_aish_fix_error() {
  local id="$1"
  _aish_load_error "$id" || { _aish_error "Error #$id not found"; return 1; }

  print -P "%F{240}Fixing: %F{white}$_aish_err_cmd%F{240} (exit $_aish_err_code)%f"

  local prompt="A shell command failed. Suggest the corrected command.
IMPORTANT: Output ONLY the corrected command, nothing else. No explanation, no markdown, no code blocks.

Command: $_aish_err_cmd
Exit code: $_aish_err_code
Shell: zsh
Directory: $_aish_err_dir"

  print -P "%F{cyan}Generating fix...%f"

  local cmd
  cmd=$(_aish_query_ai "$prompt")

  if [[ -z "$cmd" ]]; then
    print -P "\033[1A\033[2K%F{red}Failed to generate fix%f"
    return 1
  fi

  cmd=$(_aish_strip_markdown "$cmd")

  # Clear "Generating fix..." and show command
  print -P "\033[1A\033[2K%F{yellow}$cmd%f"

  # Prompt for action
  print -Pn "%F{240}[e]xecute, [c]opy to prompt, [n]o? %f"
  read -k1 action
  echo

  case "$action" in
    e|E|y|Y)
      print -P "%F{green}Executing...%f"
      eval "$cmd"
      ;;
    c|C)
      if [[ -n "$AISH_COPY_TO_BUFFER" ]]; then
        print -r -- "$cmd" >&3
      else
        print -z -- "$cmd"
      fi
      return 0
      ;;
    *)
      print -P "%F{240}Cancelled%f"
      ;;
  esac
}

_aish_explain_error() {
  local id="$1"
  _aish_load_error "$id" || { _aish_error "Error #$id not found"; return 1; }

  print -P "%F{240}Explaining: %F{white}$_aish_err_cmd%F{240} (exit $_aish_err_code)%f"

  local prompt="Explain why this shell command failed. Be concise and helpful.

Command: $_aish_err_cmd
Exit code: $_aish_err_code
Shell: zsh
Directory: $_aish_err_dir"

  print -P "%F{cyan}Thinking...%f"

  local answer
  answer=$(_aish_query_ai "$prompt")

  if [[ -n "$answer" ]]; then
    print -n "\033[1A\033[2K"
    _aish_render_output "$answer"
  else
    print -P "\033[1A\033[2K%F{red}Failed to get response%f"
    return 1
  fi
}

# ============================================================================
# Error recording hook
# ============================================================================

# Store last command for error recording
_aish_last_command=""
_aish_last_error_id=""

_aish_preexec() {
  _aish_last_command="$1"
}

_aish_precmd() {
  local last_status=$?

  # Success → clear last error
  if [[ $last_status -eq 0 ]]; then
    _aish_last_error_id=""
    _aish_last_command=""
    return
  fi

  [[ -z "$_aish_last_command" ]] && return

  # Fast-path: ignore signal exit codes (Ctrl+C, SIGPIPE, SIGTERM)
  case $last_status in
    130|141|143) _aish_last_command=""; return ;;
  esac

  # Save error and record ID
  _aish_last_error_id=$(_aish_save_error "$_aish_last_command" "$last_status")
  _aish_last_command=""
}

# Register hooks
autoload -Uz add-zsh-hook
add-zsh-hook preexec _aish_preexec
add-zsh-hook precmd _aish_precmd

# ============================================================================
# Keybindings
# ============================================================================

# Alt+J to generate command from current line (or interactive if empty)
_aish_generate_widget() {
  local request="$BUFFER"
  BUFFER=""
  zle redisplay
  echo  # Move to next line before output
  if [[ -n "$request" ]]; then
    local captured
    captured=$(AISH_COPY_TO_BUFFER=1 aish-generate "$request" 3>&1 1>/dev/tty)
    if [[ -n "$captured" ]]; then
      BUFFER="$captured"
      CURSOR=${#BUFFER}
    fi
  elif [[ -n "$_aish_last_error_id" ]]; then
    # Fix last error
    local error_id="$_aish_last_error_id"
    _aish_last_error_id=""
    local captured
    captured=$(AISH_COPY_TO_BUFFER=1 _aish_fix_error "$error_id" 3>&1 1>/dev/tty)
    if [[ -n "$captured" ]]; then
      BUFFER="$captured"
      CURSOR=${#BUFFER}
    fi
  else
    # Interactive mode when buffer is empty
    local captured
    captured=$(AISH_COPY_TO_BUFFER=1 aish-generate 3>&1 1>/dev/tty)
    if [[ -n "$captured" ]]; then
      BUFFER="$captured"
      CURSOR=${#BUFFER}
    fi
  fi
  zle reset-prompt
}
zle -N _aish_generate_widget
bindkey '^[j' _aish_generate_widget

# Alt+K to query about current line (or interactive if empty)
_aish_query_widget() {
  local query="$BUFFER"
  BUFFER=""
  zle redisplay
  echo  # Move to next line before output
  if [[ -n "$query" ]]; then
    aish-query "$query"
  elif [[ -n "$_aish_last_error_id" ]]; then
    # Explain last error
    local error_id="$_aish_last_error_id"
    _aish_last_error_id=""
    _aish_explain_error "$error_id"
  else
    # Interactive mode when buffer is empty
    aish-query
  fi
  zle reset-prompt
}
zle -N _aish_query_widget
bindkey '^[k' _aish_query_widget

# ============================================================================
# Startup message
# ============================================================================

_aish_init() {
  local backend=$(_aish_detect_backend)

  if [[ "$backend" == "none" ]]; then
    _aish_error "No AI backend available"
    _aish_error "Install 'claude' CLI or set ANTHROPIC_API_KEY"
    return 1
  fi

  _aish_debug "Initialized with backend: $backend"

  if [[ "$AISH_DEBUG" == "true" ]]; then
    print -P "%F{green}[aish]%f AI shell integration loaded (backend: $backend)"
    print -P "%F{240}  Alt+J         - Generate from current line%f"
    print -P "%F{240}  Alt+K         - Query about current line%f"
  fi
}

_aish_init
