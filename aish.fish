# aish.fish - AI Shell Integration for Fish
# Source this file in your config.fish: source /path/to/aish.fish

# Configuration: env vars > config file > defaults
set -g _aish_config_file (set -q XDG_CONFIG_HOME; and echo $XDG_CONFIG_HOME; or echo $HOME/.config)/aish/config
if test -f "$_aish_config_file"
    while read -l line
        test -z "$line"; and continue
        string match -q '#*' -- "$line"; and continue
        set -l key (string split -m1 '=' -- "$line")[1]
        set -l value (string split -m1 '=' -- "$line")[2]
        switch $key
            case backend
                set -q AISH_BACKEND; or set -g AISH_BACKEND "$value"
            case model
                set -q AISH_MODEL; or set -g AISH_MODEL "$value"
            case debug
                set -q AISH_DEBUG; or set -g AISH_DEBUG "$value"
            case highlighter
                set -q AISH_HIGHLIGHTER; or set -g AISH_HIGHLIGHTER "$value"
            case data-dir
                set -q AISH_DATA_DIR; or set -g AISH_DATA_DIR "$value"
        end
    end < "$_aish_config_file"
end
set -q AISH_BACKEND; or set -g AISH_BACKEND auto
set -q AISH_MODEL; or set -g AISH_MODEL haiku
set -q AISH_DEBUG; or set -g AISH_DEBUG false
set -q AISH_DATA_DIR; or set -g AISH_DATA_DIR (set -q XDG_DATA_HOME; and echo $XDG_DATA_HOME; or echo $HOME/.local/share)/aish
set -q AISH_HIGHLIGHTER; or set -g AISH_HIGHLIGHTER auto

# Session state (per-shell, not persisted)
set -g _aish_session_id ""
set -g _aish_session_started false

# Directory where this plugin lives
set -g AISH_DIR (dirname (status filename))

# ============================================================================
# Internal helpers
# ============================================================================

function _aish_debug
    if test "$AISH_DEBUG" = true
        set_color brblack
        echo "[aish] $argv" >&2
        set_color normal
    end
end

function _aish_error
    set_color red
    echo "[aish] $argv" >&2
    set_color normal
end

# Convert path to safe directory name (like Claude does)
function _aish_path_to_dirname
    string replace -a '/' '-' -- $argv[1]
end

# Get Claude config directory for aish
function _aish_claude_config_dir
    echo "$AISH_DATA_DIR/claude"
end

# Ensure Claude config is set up with credentials symlinked
function _aish_ensure_claude_config
    set -l aish_claude_dir (_aish_claude_config_dir)
    set -l creds_file "$aish_claude_dir/.credentials.json"

    # Create directory if needed
    test -d "$aish_claude_dir"; or mkdir -p "$aish_claude_dir" 2>/dev/null

    # Symlink credentials if not present
    if not test -e "$creds_file"; and test -f "$HOME/.claude/.credentials.json"
        ln -sf "$HOME/.claude/.credentials.json" "$creds_file" 2>/dev/null
        _aish_debug "Symlinked Claude credentials"
    end
end

# Strip markdown code blocks from AI response
function _aish_strip_markdown
    set -l text "$argv"

    # Remove ```language\n...\n``` blocks
    if string match -q '*```*' "$text"
        # Extract content between code fences
        set text (string replace -r '^.*```[a-zA-Z]*\n?' '' -- "$text")
        set text (string replace -r '\n?```.*$' '' -- "$text")
    end

    # Remove single backticks at start/end
    set text (string trim -c '`' -- "$text")

    # Trim whitespace
    string trim -- "$text"
end

# Get errors directory, creating if needed
function _aish_errors_dir
    set -l dir "$AISH_DATA_DIR/errors"
    test -d "$dir"; or mkdir -p "$dir" 2>/dev/null
    echo "$dir"
end

# Save an error record, returns the ID
function _aish_save_error
    set -l cmd "$argv[1]"
    set -l exit_code "$argv[2]"
    set -l errors_dir (_aish_errors_dir)
    set -l counter_file "$errors_dir/counter"

    # Read and increment counter
    set -l id 1
    if test -f "$counter_file"
        set id (math (cat "$counter_file") + 1)
    end
    echo "$id" > "$counter_file"

    # Write error record: exit_code, PWD, epoch on separate lines, then command last
    # Command is last because it may contain newlines
    printf '%s\n%s\n%s\n%s\n' "$exit_code" "$PWD" (date +%s) "$cmd" > "$errors_dir/$id"

    echo "$id"
end

# Load an error record by ID into global _aish_err_* variables
function _aish_load_error
    set -l id "$argv[1]"
    set -l file (_aish_errors_dir)"/$id"

    test -f "$file"; or return 1

    set -l lines
    while read -l line
        set -a lines "$line"
    end < "$file"

    set -g _aish_err_code "$lines[1]"
    set -g _aish_err_dir "$lines[2]"
    set -g _aish_err_time "$lines[3]"
    # Command is the rest (may span multiple lines)
    set -g _aish_err_cmd (string join \n $lines[4..-1])
end

# Get the latest error ID from counter
function _aish_latest_error_id
    set -l counter_file (_aish_errors_dir)/counter
    test -f "$counter_file"; and cat "$counter_file"
end

# Format epoch as relative time
function _aish_relative_time
    set -l epoch $argv[1]
    set -l now (date +%s)
    set -l diff (math $now - $epoch)

    if test $diff -lt 60
        echo {$diff}"s ago"
    else if test $diff -lt 3600
        echo (math "floor($diff / 60)")"m ago"
    else if test $diff -lt 86400
        echo (math "floor($diff / 3600)")"h ago"
    else
        echo (math "floor($diff / 86400)")"d ago"
    end
end

# Resolve AISH_HIGHLIGHTER to an actual command
function _aish_find_highlighter
    switch "$AISH_HIGHLIGHTER"
        case auto ''
            if command -v bat >/dev/null 2>&1
                echo bat
            else if command -v batcat >/dev/null 2>&1
                echo batcat
            end
        case none
            # No highlighting
        case '*'
            echo "$AISH_HIGHLIGHTER"
    end
end

# Render AI output (markdown) with syntax highlighting
function _aish_render_output
    set -l text "$argv"
    set -l highlighter (_aish_find_highlighter)

    if test -n "$highlighter"
        printf '%s\n' "$text" | $highlighter --color=always --style=plain --paging=never --language=md
    else
        set_color cyan
        printf '%s\n' "$text"
        set_color normal
    end
end

# Detect which backend to use
function _aish_detect_backend
    if test "$AISH_BACKEND" != auto
        echo "$AISH_BACKEND"
        return
    end

    # Prefer claude-code if available and no API key
    if command -v claude >/dev/null 2>&1; and test -z "$ANTHROPIC_API_KEY"
        echo claude-code
    else if test -n "$ANTHROPIC_API_KEY"
        echo api
    else if command -v claude >/dev/null 2>&1
        echo claude-code
    else
        echo none
    end
end

# Send prompt to AI and get response
# Usage: _aish_query_ai <prompt> [allow_tools]
# allow_tools: if "true", Claude can use bash/tools; otherwise tools are disabled
function _aish_resolve_model
    switch $AISH_MODEL
        case opus
            echo "claude-opus-4-6"
        case haiku
            echo "claude-haiku-4-5-20251001"
        case '*'
            echo "claude-sonnet-4-5-20250929"
    end
end

function _aish_query_ai
    set -l prompt "$argv[1]"
    set -l allow_tools "$argv[2]"
    test -z "$allow_tools"; and set allow_tools false
    set -l backend (_aish_detect_backend)

    _aish_debug "Backend: $backend"
    _aish_debug "Prompt: $prompt"
    _aish_debug "Allow tools: $allow_tools"

    switch $backend
        case claude-code
            set -l claude_config_dir (_aish_claude_config_dir)
            set -l claude_args -p "$prompt" --output-format text --model "$AISH_MODEL"

            _aish_ensure_claude_config

            if test "$allow_tools" != true
                set claude_args $claude_args --allowedTools ''
            end

            # Generate session ID on first use
            if test -z "$_aish_session_id"
                if command -v uuidgen >/dev/null 2>&1
                    set -g _aish_session_id (uuidgen | tr '[:upper:]' '[:lower:]')
                else if test -f /proc/sys/kernel/random/uuid
                    set -g _aish_session_id (cat /proc/sys/kernel/random/uuid)
                else
                    set -g _aish_session_id (od -x /dev/urandom | head -1 | awk '{print $2$3"-"$4"-"$5"-"$6"-"$7$8$9}')
                end
            end

            _aish_debug "Session ID: $_aish_session_id"
            _aish_debug "Claude config: $claude_config_dir"
            _aish_debug "Allow tools: $allow_tools"

            if test "$_aish_session_started" = true
                _aish_debug "Resuming session"
                set claude_args $claude_args --resume "$_aish_session_id"
            else
                _aish_debug "Starting new session"
                set claude_args $claude_args --session-id "$_aish_session_id"
            end

            set -l result (CLAUDE_CONFIG_DIR="$claude_config_dir" claude $claude_args 2>/dev/null)

            if test -n "$result"
                set -g _aish_session_started true
            end

            echo "$result"

        case api
            # Direct API call using curl
            set -l json_prompt (printf '%s' "$prompt" | jq -Rs .)
            set -l api_model (_aish_resolve_model)
            set -l response (curl -s https://api.anthropic.com/v1/messages \
                -H "Content-Type: application/json" \
                -H "x-api-key: $ANTHROPIC_API_KEY" \
                -H "anthropic-version: 2023-06-01" \
                -d "{
                  \"model\": \"$api_model\",
                  \"max_tokens\": 1024,
                  \"messages\": [{\"role\": \"user\", \"content\": $json_prompt}]
                }" 2>/dev/null)

            echo "$response" | jq -r '.content[0].text // empty' 2>/dev/null

        case '*'
            _aish_error "No AI backend available. Install claude CLI or set ANTHROPIC_API_KEY"
            return 1
    end
end

# ============================================================================
# Main aish command
# ============================================================================

function aish -d "AI Shell Integration"
    set -l cmd $argv[1]
    test -z "$cmd"; and set cmd help
    set -e argv[1]

    switch $cmd
        case help --help -h
            _aish_cmd_help
        case status info
            _aish_cmd_status
        case reset clear
            _aish_cmd_reset $argv
        case compact
            _aish_cmd_compact
        case config
            _aish_cmd_config $argv
        case debug
            _aish_cmd_debug
        case errors
            _aish_cmd_errors $argv
        case fix
            _aish_cmd_fix $argv
        case explain
            _aish_cmd_explain $argv
        case '*'
            _aish_error "Unknown command: $cmd"
            _aish_cmd_help
            return 1
    end
end

function _aish_cmd_help
    set_color cyan
    echo "aish"
    set_color normal
    echo " - AI Shell Integration"
    echo
    set_color yellow
    echo "Keybindings:"
    set_color normal
    echo "  Alt+J            Generate command (or fix last error if blank)"
    echo "  Alt+K            Ask question (or explain last error if blank)"
    echo
    set_color yellow
    echo "Commands:"
    set_color normal
    echo "  aish <command>   Manage aish"
    echo
    set_color yellow
    echo "Management:"
    set_color normal
    echo "  aish status      Show current session info and backend status"
    echo "  aish reset       Reset session for current dir (--all for all)"
    echo "  aish compact     Compact/summarize session to reduce context"
    echo "  aish config      Show/set config (--session for non-persistent)"
    echo "  aish debug       Toggle debug mode"
    echo
    set_color yellow
    echo "Errors:"
    set_color normal
    echo "  aish errors           List recorded errors"
    echo "  aish errors <id>      View error details"
    echo "  aish errors rm <id>   Remove an error record"
    echo "  aish errors clear     Remove all error records"
    echo "  aish fix [id]         Generate fix for error (default: latest)"
    echo "  aish explain [id]     Explain error (default: latest)"
    echo
    set_color yellow
    echo "Config keys:"
    set_color normal
    echo "  backend          auto, claude-code, api (current: $AISH_BACKEND)"
    echo "  model            sonnet, opus, haiku (current: $AISH_MODEL)"
    echo "  debug            true/false (current: $AISH_DEBUG)"
    echo "  highlighter      auto, bat, batcat, none (current: $AISH_HIGHLIGHTER)"
end

function _aish_cmd_status
    set -l claude_config_dir (_aish_claude_config_dir)
    set -l backend (_aish_detect_backend)

    set_color cyan
    echo "aish status"
    set_color normal
    echo
    set_color yellow
    echo "Session:"
    set_color normal
    if test -n "$_aish_session_id"
        echo "  Session ID:   $_aish_session_id"
        echo -n "  Active:       "
        if test "$_aish_session_started" = true
            echo "yes"
        else
            echo "no"
        end
    else
        echo "  Session ID:   (none)"
    end
    echo
    set_color yellow
    echo "Backend:"
    set_color normal
    echo "  Type:         $backend"

    if test "$backend" = claude-code -a -n "$_aish_session_id"
        set -l session_file "$claude_config_dir/projects/"(_aish_path_to_dirname $PWD)"/$_aish_session_id.jsonl"
        if test -f "$session_file"
            set -l line_count (wc -l < "$session_file" 2>/dev/null; or echo 0)
            set -l file_size (du -h "$session_file" 2>/dev/null | cut -f1; or echo unknown)
            echo "  Session file: $session_file"
            echo "  Messages:     ~"(math "$line_count / 2")
            echo "  Size:         $file_size"
        end
    end

    echo
    set_color yellow
    echo "Errors:"
    set_color normal
    set -l error_count 0
    set -l errors_dir (_aish_errors_dir)
    if test -f "$errors_dir/counter"
        set -l max_id (cat "$errors_dir/counter")
        for id in (seq 1 $max_id)
            test -f "$errors_dir/$id"; and set error_count (math $error_count + 1)
        end
    end
    echo "  Recorded:     $error_count"

    echo
    set_color yellow
    echo "Configuration:"
    set_color normal
    echo "  Data dir:     $AISH_DATA_DIR"
    echo "  Claude dir:   $claude_config_dir"
    echo "  Debug:        $AISH_DEBUG"
end

function _aish_cmd_reset
    set -l all false
    if test "$argv[1]" = --all; or test "$argv[1]" = -a
        set all true
    end

    set -g _aish_session_id ""
    set -g _aish_session_started false

    if test $all = true
        set_color yellow
        read -n 1 -P "Delete all stored session data? [y/N] " confirm
        set_color normal
        if test "$confirm" = y; or test "$confirm" = Y
            echo
            rm -rf "$AISH_DATA_DIR/sessions" "$AISH_DATA_DIR/claude/projects"
            set_color green
            echo "Session reset, stored data cleared"
            set_color normal
        else
            echo
            set_color green
            echo "Session reset"
            set_color normal
        end
    else
        set_color green
        echo "Session reset"
        set_color normal
    end
end

function _aish_cmd_compact
    if test (_aish_detect_backend) != claude-code
        _aish_error "Compact only available with claude-code backend"
        return 1
    end

    if test "$_aish_session_started" != true
        set_color yellow
        echo "No active session to compact"
        set_color normal
        return 1
    end

    set_color cyan
    echo "Compacting session..."
    set_color normal

    set -l summary (_aish_query_ai "Please provide a brief summary of our conversation so far, including any important context, decisions, or information I've shared. This will be used to continue our conversation with reduced context. Keep it concise but include key details.")

    if test -n "$summary"
        set -g _aish_session_id ""
        set -g _aish_session_started false

        _aish_query_ai "Here's a summary of our previous conversation for context: $summary

Please acknowledge you have this context and are ready to continue." >/dev/null

        set_color green
        echo "Session compacted successfully"
        set_color normal
    else
        _aish_error "Failed to compact session"
        return 1
    end
end

function _aish_save_config_key
    set -l key $argv[1]
    set -l value $argv[2]
    mkdir -p (dirname "$_aish_config_file")
    if test -f "$_aish_config_file"; and grep -q "^$key=" "$_aish_config_file"
        sed -i "s|^$key=.*|$key=$value|" "$_aish_config_file"
    else
        echo "$key=$value" >> "$_aish_config_file"
    end
end

function _aish_cmd_config
    set -l session_only false
    if test "$argv[1]" = --session
        set session_only true
        set -e argv[1]
    end

    set -l setting $argv[1]

    if test -z "$setting"
        set_color cyan
        echo "Configuration:"
        set_color normal
        echo "  backend:      $AISH_BACKEND"
        echo "  model:        $AISH_MODEL"
        echo "  debug:        $AISH_DEBUG"
        echo "  highlighter:  $AISH_HIGHLIGHTER"
        echo "  data-dir:     $AISH_DATA_DIR"
        return
    end

    set -l key (string split -m1 '=' -- "$setting")[1]
    set -l value (string split -m1 '=' -- "$setting")[2]

    if test -z "$value"
        _aish_error "Usage: aish config key=value"
        return 1
    end

    switch $key
        case backend
            set -g AISH_BACKEND "$value"
        case model
            set -g AISH_MODEL "$value"
        case debug
            set -g AISH_DEBUG "$value"
        case highlighter
            set -g AISH_HIGHLIGHTER "$value"
        case '*'
            _aish_error "Unknown config key: $key"
            _aish_error "Valid keys: backend, model, debug, highlighter"
            return 1
    end

    if test "$session_only" = true
        set_color green
        echo -n "$key: $value"
        set_color brblack
        echo " (session)"
        set_color normal
    else
        _aish_save_config_key "$key" "$value"
        set_color green
        echo "$key: $value"
        set_color normal
    end
end

function _aish_cmd_debug
    if test "$AISH_DEBUG" = true
        set -g AISH_DEBUG false
        set_color brblack
        echo "Debug mode: off"
        set_color normal
    else
        set -g AISH_DEBUG true
        set_color green
        echo "Debug mode: on"
        set_color normal
    end
end

function _aish_cmd_errors
    set -l subcmd $argv[1]
    set -l arg $argv[2]
    set -l errors_dir (_aish_errors_dir)

    switch "$subcmd"
        case rm
            if test -z "$arg"
                _aish_error "Usage: aish errors rm <id>"
                return 1
            end
            if test -f "$errors_dir/$arg"
                rm -f "$errors_dir/$arg"
                set_color green
                echo "Removed error #$arg"
                set_color normal
            else
                _aish_error "Error #$arg not found"
                return 1
            end
        case clear
            rm -f $errors_dir/[0-9]* "$errors_dir/counter" 2>/dev/null
            set_color green
            echo "All errors cleared"
            set_color normal
        case ''
            # List all errors
            set -l counter_file "$errors_dir/counter"
            if not test -f "$counter_file"
                set_color yellow
                echo "No errors recorded"
                set_color normal
                return
            end
            set -l max_id (cat "$counter_file")
            set -l found false
            for id in (seq 1 $max_id)
                test -f "$errors_dir/$id"; or continue
                set found true
                _aish_load_error "$id"
                set -l rel_time (_aish_relative_time "$_aish_err_time")
                set -l short_cmd "$_aish_err_cmd"
                if test (string length "$short_cmd") -gt 30
                    set short_cmd (string sub -l 27 "$short_cmd")"..."
                end
                printf '  #%-3s  exit %-4s  %-30s  %-20s  %s\n' \
                    "$id" "$_aish_err_code" "$short_cmd" "$_aish_err_dir" "$rel_time"
            end
            if test $found = false
                set_color yellow
                echo "No errors recorded"
                set_color normal
            end
        case '*'
            # View specific error by ID
            if string match -qr '^[0-9]+$' -- "$subcmd"
                if not _aish_load_error "$subcmd"
                    _aish_error "Error #$subcmd not found"
                    return 1
                end
                set -l timestamp (date -d "@$_aish_err_time" '+%Y-%m-%d %H:%M:%S' 2>/dev/null; or echo "$_aish_err_time")
                set_color cyan
                echo "Error #$subcmd"
                set_color normal
                echo "  Command:   $_aish_err_cmd"
                echo "  Exit code: $_aish_err_code"
                echo "  Directory: $_aish_err_dir"
                echo "  Time:      $timestamp"
            else
                _aish_error "Unknown errors subcommand: $subcmd"
                return 1
            end
    end
end

function _aish_cmd_fix
    set -l id $argv[1]
    if test -z "$id"
        set id (_aish_latest_error_id)
    end
    if test -z "$id"
        _aish_error "No errors recorded"
        return 1
    end
    _aish_fix_error "$id"
end

function _aish_cmd_explain
    set -l id $argv[1]
    if test -z "$id"
        set id (_aish_latest_error_id)
    end
    if test -z "$id"
        _aish_error "No errors recorded"
        return 1
    end
    _aish_explain_error "$id"
end

# ============================================================================
# Query and Generate functions
# ============================================================================

function aish-query -d "Ask AI a question"
    set -l query "$argv"

    # Interactive mode if no args provided
    if test -z "$query"
        read -P (set_color cyan)"? "(set_color normal) query; or return 0
        if test -z "$query"
            return 0
        end
    end

    set -l prompt "Answer this question concisely. Be direct and helpful.
Current directory: $PWD
Shell: fish

Question: $query"

    set_color cyan
    echo "Thinking..."
    set_color normal

    set -l answer (_aish_query_ai "$prompt")

    if test -n "$answer"
        # Move up one line, clear it, and print answer
        printf '\033[1A\033[2K'
        _aish_render_output "$answer"
    else
        printf '\033[1A\033[2K'
        set_color red
        echo "Failed to get response"
        set_color normal
        return 1
    end
end

function aish-generate -d "Generate shell command from description"
    set -l request "$argv"

    # Interactive mode if no args provided
    if test -z "$request"
        read -P (set_color yellow)"! "(set_color normal) request; or return 0
        if test -z "$request"
            return 0
        end
    end

    set -l prompt "Generate a shell command for fish shell based on this request.
IMPORTANT: Output ONLY the command, nothing else. No explanation, no markdown, no code blocks.

Current directory: $PWD
Request: $request"

    set_color cyan
    echo "Generating..."
    set_color normal

    set -l cmd (_aish_query_ai "$prompt")

    if test -z "$cmd"
        printf '\033[1A\033[2K'
        set_color red
        echo "Failed to generate command"
        set_color normal
        return 1
    end

    # Clean up command (remove any accidental markdown)
    set cmd (_aish_strip_markdown "$cmd")

    # Clear "Generating..." and show command
    printf '\033[1A\033[2K'
    set_color yellow
    echo "$cmd"
    set_color normal

    # Prompt for action
    set_color brblack
    read -n 1 -P "[e]xecute, [c]opy to prompt, [n]o? " action
    set_color normal

    switch $action
        case e E y Y
            echo
            set_color green
            echo "Executing..."
            set_color normal
            eval $cmd
        case c C
            echo
            # Set the command line buffer to the generated command
            commandline -r "$cmd"
            commandline -f repaint
        case '*'
            echo
            set_color brblack
            echo "Cancelled"
            set_color normal
    end
end

# ============================================================================
# Error fix and explain
# ============================================================================

function _aish_fix_error -d "Generate fix for a recorded error"
    set -l id $argv[1]
    if not _aish_load_error "$id"
        _aish_error "Error #$id not found"
        return 1
    end

    set_color brblack
    printf 'Fixing: '
    set_color normal
    echo "$_aish_err_cmd (exit $_aish_err_code)"

    set -l prompt "A shell command failed. Suggest the corrected command.
IMPORTANT: Output ONLY the corrected command, nothing else. No explanation, no markdown, no code blocks.

Command: $_aish_err_cmd
Exit code: $_aish_err_code
Shell: fish
Directory: $_aish_err_dir"

    set_color cyan
    echo "Generating fix..."
    set_color normal

    set -l cmd (_aish_query_ai "$prompt")

    if test -z "$cmd"
        printf '\033[1A\033[2K'
        set_color red
        echo "Failed to generate fix"
        set_color normal
        return 1
    end

    set cmd (_aish_strip_markdown "$cmd")

    # Clear "Generating fix..." and show command
    printf '\033[1A\033[2K'
    set_color yellow
    echo "$cmd"
    set_color normal

    # Prompt for action
    set_color brblack
    read -n 1 -P "[e]xecute, [c]opy to prompt, [n]o? " action
    set_color normal

    switch $action
        case e E y Y
            echo
            set_color green
            echo "Executing..."
            set_color normal
            eval $cmd
        case c C
            echo
            commandline -r "$cmd"
            commandline -f repaint
        case '*'
            echo
            set_color brblack
            echo "Cancelled"
            set_color normal
    end
end

function _aish_explain_error -d "Explain a recorded error"
    set -l id $argv[1]
    if not _aish_load_error "$id"
        _aish_error "Error #$id not found"
        return 1
    end

    set_color brblack
    printf 'Explaining: '
    set_color normal
    echo "$_aish_err_cmd (exit $_aish_err_code)"

    set -l prompt "Explain why this shell command failed. Be concise and helpful.

Command: $_aish_err_cmd
Exit code: $_aish_err_code
Shell: fish
Directory: $_aish_err_dir"

    set_color cyan
    echo "Thinking..."
    set_color normal

    set -l answer (_aish_query_ai "$prompt")

    if test -n "$answer"
        printf '\033[1A\033[2K'
        _aish_render_output "$answer"
    else
        printf '\033[1A\033[2K'
        set_color red
        echo "Failed to get response"
        set_color normal
        return 1
    end
end

# ============================================================================
# Error recording hook
# ============================================================================

# Store last command for error recording
set -g _aish_last_command ""
set -g _aish_last_error_id ""

function _aish_fish_preexec --on-event fish_preexec
    set -g _aish_last_command "$argv"
end

function _aish_fish_postexec --on-event fish_postexec
    set -l last_status $status

    # Success → clear last error
    if test $last_status -eq 0
        set -g _aish_last_error_id ""
        set -g _aish_last_command ""
        return
    end

    test -z "$_aish_last_command"; and return

    # Fast-path: ignore signal exit codes (Ctrl+C, SIGPIPE, SIGTERM)
    switch $last_status
        case 130 141 143
            set -g _aish_last_command ""
            return
    end

    # Save error and record ID
    set -g _aish_last_error_id (_aish_save_error "$_aish_last_command" "$last_status")
    set -g _aish_last_command ""
end

# ============================================================================
# Keybindings
# ============================================================================

# Track if we're in interactive aish mode (to prevent recursion)
set -g _aish_interactive_mode ""

# Alt+J to generate command from current line (or interactive if empty)
function _aish_generate_binding
    # Block if already in interactive mode
    test -n "$_aish_interactive_mode"; and return

    set -l request (commandline -b)
    commandline -r ""
    commandline -f repaint
    echo  # Move to next line before output
    if test -n "$request"
        aish-generate "$request"
    else if test -n "$_aish_last_error_id"
        # Fix last error
        set -l error_id "$_aish_last_error_id"
        set -g _aish_last_error_id ""
        _aish_fix_error "$error_id"
    else
        # Interactive mode when buffer is empty
        set -g _aish_interactive_mode "generate"
        aish-generate
        set -g _aish_interactive_mode ""
    end
    commandline -f repaint
end

# Alt+K to query about current line (or interactive if empty)
function _aish_query_binding
    # Block if already in interactive mode
    test -n "$_aish_interactive_mode"; and return

    set -l query (commandline -b)
    commandline -r ""
    commandline -f repaint
    echo  # Move to next line before output
    if test -n "$query"
        aish-query "$query"
    else if test -n "$_aish_last_error_id"
        # Explain last error
        set -l error_id "$_aish_last_error_id"
        set -g _aish_last_error_id ""
        _aish_explain_error "$error_id"
    else
        # Interactive mode when buffer is empty
        set -g _aish_interactive_mode "query"
        aish-query
        set -g _aish_interactive_mode ""
    end
    commandline -f repaint
end

# Bind keys
bind \ej _aish_generate_binding
bind \ek _aish_query_binding

# Also bind for vi mode if applicable
if bind -M insert >/dev/null 2>&1
    bind -M insert \ej _aish_generate_binding
    bind -M insert \ek _aish_query_binding
end

# ============================================================================
# Completions
# ============================================================================

complete -c aish -f
complete -c aish -n "__fish_use_subcommand" -a "help" -d "Show help"
complete -c aish -n "__fish_use_subcommand" -a "status" -d "Show session info"
complete -c aish -n "__fish_use_subcommand" -a "reset" -d "Reset session"
complete -c aish -n "__fish_use_subcommand" -a "compact" -d "Compact session"
complete -c aish -n "__fish_use_subcommand" -a "config" -d "Show/set config"
complete -c aish -n "__fish_use_subcommand" -a "debug" -d "Toggle debug"
complete -c aish -n "__fish_use_subcommand" -a "errors" -d "List/manage errors"
complete -c aish -n "__fish_use_subcommand" -a "fix" -d "Fix an error"
complete -c aish -n "__fish_use_subcommand" -a "explain" -d "Explain an error"

complete -c aish -n "__fish_seen_subcommand_from reset" -l all -s a -d "Reset all sessions"
complete -c aish -n "__fish_seen_subcommand_from errors" -a "rm" -d "Remove error"
complete -c aish -n "__fish_seen_subcommand_from errors" -a "clear" -d "Clear all errors"

# ============================================================================
# Startup
# ============================================================================

function _aish_init
    set -l backend (_aish_detect_backend)

    if test "$backend" = none
        _aish_error "No AI backend available"
        _aish_error "Install 'claude' CLI or set ANTHROPIC_API_KEY"
        return 1
    end

    _aish_debug "Initialized with backend: $backend"

    if test "$AISH_DEBUG" = true
        set_color green
        echo -n "[aish]"
        set_color normal
        echo " AI shell integration loaded (backend: $backend)"
        set_color brblack
        echo "  Alt+J         - Generate from current line"
        echo "  Alt+K         - Query about current line"
        set_color normal
    end
end

_aish_init
