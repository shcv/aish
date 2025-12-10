# aish.plugin.zsh - AI Shell Integration for Zsh
# Source this file in your .zshrc: source /path/to/aish.plugin.zsh

# Configuration (can be overridden before sourcing)
: ${AISH_BACKEND:=auto}          # auto, claude-code, api
: ${AISH_MODEL:=sonnet}          # sonnet, opus, haiku
: ${AISH_ERROR_CORRECTION:=true} # Enable error correction prompts
: ${AISH_DEBUG:=false}           # Show debug output
: ${AISH_DATA_DIR:=${XDG_DATA_HOME:-$HOME/.local/share}/aish}  # Data directory

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

# Get session directory for current working directory
_aish_session_dir() {
  local dirname=$(_aish_path_to_dirname "$PWD")
  echo "${AISH_DATA_DIR}/sessions/${dirname}"
}

# Get session ID file path
_aish_session_file() {
  echo "$(_aish_session_dir)/session-id"
}

# Check if session has been started
_aish_session_exists() {
  local started_file="$(_aish_session_dir)/started"
  [[ -f "$started_file" ]]
}

# Mark session as started
_aish_mark_session_started() {
  local started_file="$(_aish_session_dir)/started"
  touch "$started_file" 2>/dev/null
}

# Ensure session directory exists
_aish_ensure_session_dir() {
  local dir=$(_aish_session_dir)
  [[ -d "$dir" ]] || mkdir -p "$dir" 2>/dev/null
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

# Get or create session ID for current directory
_aish_get_session_id() {
  local session_file=$(_aish_session_file)

  if [[ -f "$session_file" ]]; then
    cat "$session_file"
  else
    # Generate a new UUID using various methods
    local uuid
    if command -v uuidgen &>/dev/null; then
      uuid=$(uuidgen | tr '[:upper:]' '[:lower:]')
    elif [[ -f /proc/sys/kernel/random/uuid ]]; then
      uuid=$(cat /proc/sys/kernel/random/uuid)
    else
      # Fallback: generate from random data
      uuid=$(od -x /dev/urandom | head -1 | awk '{print $2$3"-"$4"-"$5"-"$6"-"$7$8$9}')
    fi

    _aish_ensure_session_dir
    echo "$uuid" > "$session_file" 2>/dev/null
    echo "$uuid"
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
  local backend=$(_aish_detect_backend)

  _aish_debug "Backend: $backend"
  _aish_debug "Prompt: $prompt"

  case "$backend" in
    claude-code)
      local session_id=$(_aish_get_session_id)
      local claude_config_dir=$(_aish_claude_config_dir)
      local result

      # Ensure our Claude config dir is set up
      _aish_ensure_claude_config

      _aish_debug "Session ID: $session_id"
      _aish_debug "Claude config: $claude_config_dir"

      if _aish_session_exists; then
        # Continue existing session
        _aish_debug "Resuming existing session"
        result=$(CLAUDE_CONFIG_DIR="$claude_config_dir" claude -p "$prompt" --resume "$session_id" --output-format text 2>/dev/null)
      else
        # Start new session with our ID
        _aish_debug "Starting new session"
        result=$(CLAUDE_CONFIG_DIR="$claude_config_dir" claude -p "$prompt" --session-id "$session_id" --output-format text 2>/dev/null)
        _aish_mark_session_started
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
    sessions|list)
      _aish_cmd_sessions
      ;;
    switch)
      _aish_cmd_switch "$@"
      ;;
    config)
      _aish_cmd_config "$@"
      ;;
    debug)
      _aish_cmd_debug
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
  print -P "%F{yellow}Usage:%f"
  print "  ? <question>     Ask AI a question"
  print "  ! <request>      Generate a shell command"
  print "  aish <command>   Manage aish"
  print ""
  print -P "%F{yellow}Commands:%f"
  print "  status           Show current session info and usage"
  print "  reset [--all]    Reset session for current dir (--all for all sessions)"
  print "  compact          Compact/summarize current session to reduce context"
  print "  sessions         List all sessions"
  print "  switch <id>      Switch to a different session"
  print "  config [key=val] Show or set configuration"
  print "  debug            Toggle debug mode"
  print "  help             Show this help"
  print ""
  print -P "%F{yellow}Keybindings:%f"
  print "  Alt+J            Generate command from current line"
  print "  Alt+K            Ask about current line"
  print ""
  print -P "%F{yellow}Configuration:%f"
  print "  AISH_BACKEND     auto, claude-code, api (current: $AISH_BACKEND)"
  print "  AISH_MODEL       sonnet, opus, haiku (current: $AISH_MODEL)"
  print "  AISH_DEBUG       true/false (current: $AISH_DEBUG)"
  print "  AISH_DATA_DIR    Data directory (current: $AISH_DATA_DIR)"
}

_aish_cmd_status() {
  local session_id=$(_aish_get_session_id)
  local session_dir=$(_aish_session_dir)
  local claude_config_dir=$(_aish_claude_config_dir)
  local backend=$(_aish_detect_backend)

  print -P "%F{cyan}aish status%f"
  print ""
  print -P "%F{yellow}Session:%f"
  print "  Directory:    $PWD"
  print "  Session ID:   $session_id"
  print "  Active:       $(_aish_session_exists && echo "yes" || echo "no")"
  print ""
  print -P "%F{yellow}Backend:%f"
  print "  Type:         $backend"

  if [[ "$backend" == "claude-code" ]]; then
    # Try to get session info from Claude
    local session_file="${claude_config_dir}/projects/$(_aish_path_to_dirname "$PWD")/${session_id}.jsonl"
    if [[ -f "$session_file" ]]; then
      local line_count=$(wc -l < "$session_file" 2>/dev/null || echo "0")
      local file_size=$(du -h "$session_file" 2>/dev/null | cut -f1 || echo "unknown")
      print "  Session file: $session_file"
      print "  Messages:     ~$((line_count / 2))"
      print "  Size:         $file_size"
    else
      print "  Session file: (not yet created)"
    fi
  fi

  print ""
  print -P "%F{yellow}Configuration:%f"
  print "  Data dir:     $AISH_DATA_DIR"
  print "  Claude dir:   $claude_config_dir"
  print "  Debug:        $AISH_DEBUG"
  print "  Error correction: $AISH_ERROR_CORRECTION"
}

_aish_cmd_reset() {
  local all=false
  [[ "$1" == "--all" || "$1" == "-a" ]] && all=true

  if $all; then
    print -P "%F{yellow}Reset ALL sessions? This cannot be undone. [y/N]%f"
    read -k1 confirm
    echo
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
      rm -rf "${AISH_DATA_DIR}/sessions"
      rm -rf "${AISH_DATA_DIR}/claude/projects"
      print -P "%F{green}All sessions cleared%f"
    else
      print -P "%F{240}Cancelled%f"
    fi
  else
    local session_dir=$(_aish_session_dir)
    local session_id=$(_aish_get_session_id)
    local claude_session_dir="${AISH_DATA_DIR}/claude/projects/$(_aish_path_to_dirname "$PWD")"

    if [[ -d "$session_dir" ]]; then
      rm -rf "$session_dir"
      # Also remove Claude's session data
      [[ -d "$claude_session_dir" ]] && rm -rf "$claude_session_dir"
      print -P "%F{green}Session reset for $PWD%f"
    else
      print -P "%F{yellow}No session to reset%f"
    fi
  fi
}

_aish_cmd_compact() {
  if [[ "$(_aish_detect_backend)" != "claude-code" ]]; then
    _aish_error "Compact only available with claude-code backend"
    return 1
  fi

  local session_id=$(_aish_get_session_id)

  if ! _aish_session_exists; then
    print -P "%F{yellow}No active session to compact%f"
    return 1
  fi

  print -P "%F{cyan}Compacting session...%f"

  # Ask Claude to summarize the conversation so we can start fresh with context
  local summary
  summary=$(_aish_query_ai "Please provide a brief summary of our conversation so far, including any important context, decisions, or information I've shared. This will be used to continue our conversation with reduced context. Keep it concise but include key details.")

  if [[ -n "$summary" ]]; then
    # Reset session
    _aish_cmd_reset

    # Start new session with the summary as context
    _aish_query_ai "Here's a summary of our previous conversation for context: $summary

Please acknowledge you have this context and are ready to continue."

    print -P "%F{green}Session compacted successfully%f"
  else
    _aish_error "Failed to compact session"
    return 1
  fi
}

_aish_cmd_sessions() {
  local sessions_dir="${AISH_DATA_DIR}/sessions"

  if [[ ! -d "$sessions_dir" ]]; then
    print -P "%F{yellow}No sessions found%f"
    return
  fi

  print -P "%F{cyan}Sessions:%f"
  print ""

  local current_dirname=$(_aish_path_to_dirname "$PWD")

  for dir in "$sessions_dir"/*(N); do
    [[ -d "$dir" ]] || continue
    local dirname="${dir:t}"
    local session_id=$(cat "$dir/session-id" 2>/dev/null || echo "unknown")
    local started=$(test -f "$dir/started" && echo "active" || echo "new")
    local marker=""
    [[ "$dirname" == "$current_dirname" ]] && marker=" %F{green}(current)%f"

    # Convert dirname back to path for display
    local display_path="/${dirname//-//}"

    print -P "  %F{yellow}$session_id%f $started"
    print -P "    $display_path$marker"
  done
}

_aish_cmd_switch() {
  local target="$1"

  if [[ -z "$target" ]]; then
    print -P "%F{yellow}Usage: aish switch <session-id or path>%f"
    return 1
  fi

  local sessions_dir="${AISH_DATA_DIR}/sessions"

  # Check if it's a session ID
  for dir in "$sessions_dir"/*(N); do
    [[ -d "$dir" ]] || continue
    local session_id=$(cat "$dir/session-id" 2>/dev/null)
    if [[ "$session_id" == "$target"* ]]; then
      local dirname="${dir:t}"
      local target_path="/${dirname//-//}"
      print -P "%F{cyan}Switching to: $target_path%f"
      cd "$target_path" 2>/dev/null || {
        _aish_error "Directory not found: $target_path"
        return 1
      }
      return 0
    fi
  done

  # Check if it's a path
  if [[ -d "$target" ]]; then
    cd "$target"
    return 0
  fi

  _aish_error "Session or path not found: $target"
  return 1
}

_aish_cmd_config() {
  local setting="$1"

  if [[ -z "$setting" ]]; then
    # Show current config
    print -P "%F{cyan}Current configuration:%f"
    print "  AISH_BACKEND=$AISH_BACKEND"
    print "  AISH_MODEL=$AISH_MODEL"
    print "  AISH_DEBUG=$AISH_DEBUG"
    print "  AISH_ERROR_CORRECTION=$AISH_ERROR_CORRECTION"
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
    error_correction|AISH_ERROR_CORRECTION)
      AISH_ERROR_CORRECTION="$value"
      print -P "%F{green}AISH_ERROR_CORRECTION=$value%f"
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

# Ask a question - callable as: ? what is the capital of France
aish-query() {
  local query="$*"

  if [[ -z "$query" ]]; then
    print -P "%F{yellow}Usage: ? <question>%f"
    return 1
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
    print -P "\033[1A\033[2K%F{cyan}$answer%f"
  else
    print -P "\033[1A\033[2K%F{red}Failed to get response%f"
    return 1
  fi
}

# Generate command - callable as: ! find all python files
aish-generate() {
  local request="$*"

  if [[ -z "$request" ]]; then
    print -P "%F{yellow}Usage: ! <description>%f"
    return 1
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

# Suggest correction for failed command
aish-correct() {
  local failed_cmd="$1"
  local exit_code="$2"
  local error_output="$3"

  local prompt="This shell command failed. Suggest a corrected version.
IMPORTANT: Output ONLY the corrected command, nothing else.

Failed command: $failed_cmd
Exit code: $exit_code
Error: $error_output
Current directory: $PWD"

  local suggestion
  suggestion=$(_aish_query_ai "$prompt")

  if [[ -z "$suggestion" || "$suggestion" == "$failed_cmd" ]]; then
    return 1
  fi

  # Clean up
  suggestion=$(_aish_strip_markdown "$suggestion")

  print -P "%F{yellow}Suggested fix: %F{white}$suggestion%f"
  print -Pn "%F{240}[e]xecute, [c]opy to prompt, [n]o? %f"
  read -k1 action
  echo

  case "$action" in
    e|E|y|Y)
      eval "$suggestion"
      ;;
    c|C)
      print -z -- "$suggestion"
      return 0
      ;;
  esac
}

# ============================================================================
# Aliases for ? and !
# ============================================================================

alias '?'='aish-query'
alias '!'='aish-generate'

# ============================================================================
# Error correction hook
# ============================================================================

# Store last command and its output for error correction
_aish_last_command=""
_aish_last_status=0

_aish_preexec() {
  _aish_last_command="$1"
}

_aish_precmd() {
  _aish_last_status=$?

  # Skip if disabled or command succeeded
  [[ "$AISH_ERROR_CORRECTION" != "true" ]] && return
  [[ $_aish_last_status -eq 0 ]] && return
  [[ -z "$_aish_last_command" ]] && return

  # Skip common "expected" failures
  case "$_aish_last_command" in
    grep*|rg*|find*|which*|test*|\[*)
      # These often return non-zero normally
      [[ $_aish_last_status -eq 1 ]] && return
      ;;
  esac

  # Offer correction
  print -P "%F{red}Command failed (exit $_aish_last_status)%f"
  print -Pn "%F{240}Ask AI for correction? [y/n] %f"
  read -k1 ask
  echo

  if [[ "$ask" == "y" || "$ask" == "Y" ]]; then
    aish-correct "$_aish_last_command" "$_aish_last_status" ""
  fi

  _aish_last_command=""
}

# Register hooks
autoload -Uz add-zsh-hook
add-zsh-hook preexec _aish_preexec
add-zsh-hook precmd _aish_precmd

# ============================================================================
# Keybindings
# ============================================================================

# Alt+J to generate command from current line
_aish_generate_widget() {
  local request="$BUFFER"
  if [[ -n "$request" ]]; then
    BUFFER=""
    zle redisplay
    local captured
    captured=$(AISH_COPY_TO_BUFFER=1 aish-generate "$request" 3>&1 1>/dev/tty)
    if [[ -n "$captured" ]]; then
      BUFFER="$captured"
      CURSOR=${#BUFFER}
      zle redisplay
    fi
  fi
}
zle -N _aish_generate_widget
bindkey '^[j' _aish_generate_widget

# Alt+K to query (keeps line, asks about it)
_aish_query_widget() {
  local query="$BUFFER"
  if [[ -n "$query" ]]; then
    BUFFER=""
    zle redisplay
    aish-query "$query"
  fi
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
    print -P "%F{240}  ? <question>  - Ask a question%f"
    print -P "%F{240}  ! <request>   - Generate command%f"
    print -P "%F{240}  Alt+J         - Generate from current line%f"
    print -P "%F{240}  Alt+K         - Query about current line%f"
  fi
}

_aish_init
