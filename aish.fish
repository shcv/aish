# aish.fish - AI Shell Integration for Fish
# Source this file in your config.fish: source /path/to/aish.fish

# Configuration (can be overridden before sourcing)
set -q AISH_BACKEND; or set -g AISH_BACKEND auto          # auto, claude-code, api
set -q AISH_MODEL; or set -g AISH_MODEL sonnet            # sonnet, opus, haiku
set -q AISH_DEBUG; or set -g AISH_DEBUG false             # Show debug output
set -q AISH_DATA_DIR; or set -g AISH_DATA_DIR (set -q XDG_DATA_HOME; and echo $XDG_DATA_HOME; or echo $HOME/.local/share)/aish

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

# Get session directory for current working directory
function _aish_session_dir
    set -l dirname (_aish_path_to_dirname $PWD)
    echo "$AISH_DATA_DIR/sessions/$dirname"
end

# Get session ID file path
function _aish_session_file
    echo (_aish_session_dir)/session-id
end

# Check if session has been started
function _aish_session_exists
    set -l started_file (_aish_session_dir)/started
    test -f "$started_file"
end

# Mark session as started
function _aish_mark_session_started
    set -l started_file (_aish_session_dir)/started
    touch "$started_file" 2>/dev/null
end

# Ensure session directory exists
function _aish_ensure_session_dir
    set -l dir (_aish_session_dir)
    test -d "$dir"; or mkdir -p "$dir" 2>/dev/null
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

# Get or create session ID for current directory
function _aish_get_session_id
    set -l session_file (_aish_session_file)

    if test -f "$session_file"
        cat "$session_file"
    else
        # Generate a new UUID
        set -l uuid
        if command -v uuidgen >/dev/null 2>&1
            set uuid (uuidgen | tr '[:upper:]' '[:lower:]')
        else if test -f /proc/sys/kernel/random/uuid
            set uuid (cat /proc/sys/kernel/random/uuid)
        else
            # Fallback: generate from random data
            set uuid (od -x /dev/urandom | head -1 | awk '{print $2$3"-"$4"-"$5"-"$6"-"$7$8$9}')
        end

        _aish_ensure_session_dir
        echo "$uuid" > "$session_file" 2>/dev/null
        echo "$uuid"
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

    # Write error record (4 lines: command, exit_code, PWD, epoch)
    printf '%s\n%s\n%s\n%s\n' "$cmd" "$exit_code" "$PWD" (date +%s) > "$errors_dir/$id"

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

    set -g _aish_err_cmd "$lines[1]"
    set -g _aish_err_code "$lines[2]"
    set -g _aish_err_dir "$lines[3]"
    set -g _aish_err_time "$lines[4]"
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
            set -l session_id (_aish_get_session_id)
            set -l claude_config_dir (_aish_claude_config_dir)
            set -l claude_args -p "$prompt" --output-format text

            # Ensure our Claude config dir is set up
            _aish_ensure_claude_config

            # Restrict tools for query-only mode (prevents accidental command execution)
            if test "$allow_tools" != true
                set claude_args $claude_args --allowedTools ''
            end

            _aish_debug "Session ID: $session_id"
            _aish_debug "Claude config: $claude_config_dir"

            if _aish_session_exists
                # Continue existing session
                _aish_debug "Resuming existing session"
                set claude_args $claude_args --resume "$session_id"
            else
                # Start new session with our ID
                _aish_debug "Starting new session"
                set claude_args $claude_args --session-id "$session_id"
            end

            set -l result (CLAUDE_CONFIG_DIR="$claude_config_dir" claude $claude_args 2>/dev/null)

            if not _aish_session_exists
                _aish_mark_session_started
            end

            echo "$result"

        case api
            # Direct API call using curl
            set -l json_prompt (printf '%s' "$prompt" | jq -Rs .)
            set -l response (curl -s https://api.anthropic.com/v1/messages \
                -H "Content-Type: application/json" \
                -H "x-api-key: $ANTHROPIC_API_KEY" \
                -H "anthropic-version: 2023-06-01" \
                -d "{
                  \"model\": \"claude-sonnet-4-20250514\",
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
        case sessions list
            _aish_cmd_sessions
        case switch
            _aish_cmd_switch $argv
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
    echo "  aish sessions    List all sessions"
    echo "  aish switch <id> Switch to a different session"
    echo "  aish config      Show or set configuration"
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
    echo "Configuration:"
    set_color normal
    echo "  AISH_BACKEND     auto, claude-code, api (current: $AISH_BACKEND)"
    echo "  AISH_MODEL       sonnet, opus, haiku (current: $AISH_MODEL)"
    echo "  AISH_DEBUG       true/false (current: $AISH_DEBUG)"
    echo "  AISH_DATA_DIR    Data directory"
end

function _aish_cmd_status
    set -l session_id (_aish_get_session_id)
    set -l session_dir (_aish_session_dir)
    set -l claude_config_dir (_aish_claude_config_dir)
    set -l backend (_aish_detect_backend)

    set_color cyan
    echo "aish status"
    set_color normal
    echo
    set_color yellow
    echo "Session:"
    set_color normal
    echo "  Directory:    $PWD"
    echo "  Session ID:   $session_id"
    echo -n "  Active:       "
    if _aish_session_exists
        echo "yes"
    else
        echo "no"
    end
    echo
    set_color yellow
    echo "Backend:"
    set_color normal
    echo "  Type:         $backend"

    if test "$backend" = claude-code
        set -l session_file "$claude_config_dir/projects/"(_aish_path_to_dirname $PWD)"/$session_id.jsonl"
        if test -f "$session_file"
            set -l line_count (wc -l < "$session_file" 2>/dev/null; or echo 0)
            set -l file_size (du -h "$session_file" 2>/dev/null | cut -f1; or echo unknown)
            echo "  Session file: $session_file"
            echo "  Messages:     ~"(math "$line_count / 2")
            echo "  Size:         $file_size"
        else
            echo "  Session file: (not yet created)"
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

    if test $all = true
        set_color yellow
        read -n 1 -P "Reset ALL sessions? This cannot be undone. [y/N] " confirm
        set_color normal
        if test "$confirm" = y; or test "$confirm" = Y
            echo
            rm -rf "$AISH_DATA_DIR/sessions"
            rm -rf "$AISH_DATA_DIR/claude/projects"
            set_color green
            echo "All sessions cleared"
            set_color normal
        else
            echo
            set_color brblack
            echo "Cancelled"
            set_color normal
        end
    else
        set -l session_dir (_aish_session_dir)
        set -l claude_session_dir "$AISH_DATA_DIR/claude/projects/"(_aish_path_to_dirname $PWD)

        if test -d "$session_dir"
            rm -rf "$session_dir"
            # Also remove Claude's session data
            test -d "$claude_session_dir"; and rm -rf "$claude_session_dir"
            set_color green
            echo "Session reset for $PWD"
            set_color normal
        else
            set_color yellow
            echo "No session to reset"
            set_color normal
        end
    end
end

function _aish_cmd_compact
    if test (_aish_detect_backend) != claude-code
        _aish_error "Compact only available with claude-code backend"
        return 1
    end

    if not _aish_session_exists
        set_color yellow
        echo "No active session to compact"
        set_color normal
        return 1
    end

    set_color cyan
    echo "Compacting session..."
    set_color normal

    # Ask Claude to summarize the conversation
    set -l summary (_aish_query_ai "Please provide a brief summary of our conversation so far, including any important context, decisions, or information I've shared. This will be used to continue our conversation with reduced context. Keep it concise but include key details.")

    if test -n "$summary"
        # Reset session
        _aish_cmd_reset

        # Start new session with the summary as context
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

function _aish_cmd_sessions
    set -l sessions_dir "$AISH_DATA_DIR/sessions"

    if not test -d "$sessions_dir"
        set_color yellow
        echo "No sessions found"
        set_color normal
        return
    end

    set_color cyan
    echo "Sessions:"
    set_color normal
    echo

    set -l current_dirname (_aish_path_to_dirname $PWD)

    for dir in $sessions_dir/*/
        test -d "$dir"; or continue
        set -l dirname (basename "$dir")
        set -l session_id (cat "$dir/session-id" 2>/dev/null; or echo unknown)
        set -l started
        if test -f "$dir/started"
            set started active
        else
            set started new
        end

        set -l marker ""
        if test "$dirname" = "$current_dirname"
            set marker " (current)"
        end

        # Convert dirname back to path for display
        set -l display_path "/"(string replace -a '-' '/' -- "$dirname")

        set_color yellow
        echo -n "  $session_id"
        set_color normal
        echo " $started"
        echo -n "    $display_path"
        if test -n "$marker"
            set_color green
            echo "$marker"
            set_color normal
        else
            echo
        end
    end
end

function _aish_cmd_switch
    set -l target $argv[1]

    if test -z "$target"
        set_color yellow
        echo "Usage: aish switch <session-id or path>"
        set_color normal
        return 1
    end

    set -l sessions_dir "$AISH_DATA_DIR/sessions"

    # Check if it's a session ID
    for dir in $sessions_dir/*/
        test -d "$dir"; or continue
        set -l session_id (cat "$dir/session-id" 2>/dev/null)
        if string match -q "$target*" "$session_id"
            set -l dirname (basename "$dir")
            set -l target_path "/"(string replace -a '-' '/' -- "$dirname")
            set_color cyan
            echo "Switching to: $target_path"
            set_color normal
            cd "$target_path" 2>/dev/null; or begin
                _aish_error "Directory not found: $target_path"
                return 1
            end
            return 0
        end
    end

    # Check if it's a path
    if test -d "$target"
        cd "$target"
        return 0
    end

    _aish_error "Session or path not found: $target"
    return 1
end

function _aish_cmd_config
    set -l setting $argv[1]
    set -e argv[1]

    if test -z "$setting"
        # Show current config
        set_color cyan
        echo "Current configuration:"
        set_color normal
        echo "  AISH_BACKEND=$AISH_BACKEND"
        echo "  AISH_MODEL=$AISH_MODEL"
        echo "  AISH_DEBUG=$AISH_DEBUG"
        echo "  AISH_DATA_DIR=$AISH_DATA_DIR"
        return
    end

    # Parse key=value
    set -l key (string split -m1 '=' -- "$setting")[1]
    set -l value (string split -m1 '=' -- "$setting")[2]

    switch $key
        case backend AISH_BACKEND
            set -g AISH_BACKEND "$value"
            set_color green
            echo "AISH_BACKEND=$value"
            set_color normal
        case model AISH_MODEL
            set -g AISH_MODEL "$value"
            set_color green
            echo "AISH_MODEL=$value"
            set_color normal
        case debug AISH_DEBUG
            set -g AISH_DEBUG "$value"
            set_color green
            echo "AISH_DEBUG=$value"
            set_color normal
        case '*'
            _aish_error "Unknown config key: $key"
            return 1
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
        # Use printf to avoid interpreting escapes in the answer
        printf '\033[1A\033[2K'
        set_color cyan
        printf '%s\n' "$answer"
        set_color normal
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
        set_color cyan
        printf '%s\n' "$answer"
        set_color normal
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
complete -c aish -n "__fish_use_subcommand" -a "sessions" -d "List sessions"
complete -c aish -n "__fish_use_subcommand" -a "switch" -d "Switch session"
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
