import { query } from '@anthropic-ai/claude-code';
import { EventEmitter } from 'events';
import chalk from 'chalk';

export class ClaudeClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.isConnected = false;
    this.sessionId = null;
    this.queryStream = null;
    this.messageQueue = [];
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    this.contextInitialized = false;
    this.lastCwd = null;
    this.systemContext = null;
  }

  async initialize() {
    try {
      // Create an async generator for streaming input
      const inputStream = this.createInputStream();
      
      // Start the persistent query stream
      this.queryStream = query({
        prompt: inputStream,
        options: {
          maxTurns: 1000, // Allow many turns in the conversation
          model: this.config.ai?.model || 'sonnet',
          permissionMode: 'bypassPermissions', // For non-interactive use
          stderr: (data) => {
            console.error('Claude stderr:', data);
          }
        }
      });

      // Start processing the output stream
      this.processOutputStream();
      
      this.isConnected = true;
      this.emit('connected');
    } catch (error) {
      console.warn('Failed to initialize Claude Code SDK:', error.message);
      console.warn('Make sure Claude Code is installed: npm install -g @anthropic-ai/claude-code');
      this.isConnected = false;
    }
  }

  async *createInputStream() {
    // This generator yields messages from our queue
    while (true) {
      // Wait for messages to be added to the queue
      if (this.messageQueue.length === 0) {
        await new Promise(resolve => {
          const checkQueue = () => {
            if (this.messageQueue.length > 0 || !this.isConnected) {
              this.removeListener('messageQueued', checkQueue);
              resolve();
            }
          };
          this.on('messageQueued', checkQueue);
        });
      }

      if (!this.isConnected) {
        break;
      }

      if (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        yield message;
      }
    }
  }

  async processOutputStream() {
    try {
      let currentResponse = {
        requestId: null,
        content: '',
        toolUses: [],
        intermediateSteps: [],
        isComplete: false,
        pendingStep: null
      };

      for await (const message of this.queryStream) {
        if (process.env.AISH_DEBUG) {
          console.log(chalk.gray(`[DEBUG] Got message type: ${message.type}, subtype: ${message.subtype}`));
        }
        if (message.type === 'system' && message.subtype === 'init') {
          this.sessionId = message.session_id;
          // Make session ID available as environment variable
          process.env.AISH_SESSION_ID = this.sessionId;
        } else if (message.type === 'assistant') {
          if (process.env.AISH_DEBUG) {
            console.log(chalk.gray(`[DEBUG] Assistant message type, has stop_reason: ${'stop_reason' in message.message}, stop_reason value: ${message.message.stop_reason}`));
          }
          // Store assistant message content
          const content = this.extractTextContent(message.message);
          
          // Check if this is a tool use message and extract tools for THIS message only
          let thisMessageToolUses = [];
          if (message.message?.content && Array.isArray(message.message.content)) {
            const toolUseBlocks = message.message.content.filter(block => block.type === 'tool_use');
            if (toolUseBlocks.length > 0) {
              // Extract detailed tool information
              thisMessageToolUses = toolUseBlocks.map(t => {
                const name = t.name || 'unknown';
                let detail = name;
                
                // Try to extract key parameters for common tools
                if (t.input) {
                  if (name === 'Read' && t.input.file_path) {
                    detail = `Read: ${t.input.file_path}`;
                  } else if (name === 'Grep' && t.input.pattern) {
                    const pattern = t.input.pattern.length > 30 ? 
                      t.input.pattern.substring(0, 27) + '...' : t.input.pattern;
                    detail = `Grep: "${pattern}"`;
                  } else if (name === 'Edit' && t.input.file_path) {
                    detail = `Edit: ${t.input.file_path}`;
                  } else if (name === 'Bash' && t.input.command) {
                    const cmd = t.input.command.length > 30 ? 
                      t.input.command.substring(0, 27) + '...' : t.input.command;
                    detail = `Bash: ${cmd}`;
                  } else if (name === 'WebSearch' && t.input.query) {
                    detail = `WebSearch: "${t.input.query}"`;
                  }
                }
                
                return detail;
              });
              
              // Add to accumulated list for final response
              currentResponse.toolUses.push(...thisMessageToolUses);
              // Debug log tool usage
              if (process.env.AISH_DEBUG) {
                console.log(chalk.gray(`[DEBUG] Claude is using tools: ${thisMessageToolUses.join(', ')}`));
              }
            }
          }
          
          // Update the current response content
          if (content) {
            currentResponse.content = content;
          }
          
          // Find request ID if not set
          if (!currentResponse.requestId) {
            currentResponse.requestId = this.findRequestForResponse(content);
          }
          
          // ALL assistant messages in stream-json format have stop_reason field
          // But multi-turn conversations have multiple messages with stop_reason: null
          // We should accumulate ALL messages and only resolve at the end (result message)
          
          if (process.env.AISH_DEBUG) {
            console.log(chalk.gray(`[DEBUG] Got assistant message, stop_reason: ${message.message.stop_reason}, content: ${content?.substring(0, 50)}...`));
          }
          
          // Store this as an intermediate step if stop_reason is null
          if (message.message.stop_reason === null) {
            const step = {
              content: content,
              toolUses: thisMessageToolUses  // Use the tools from THIS message only
            };
            currentResponse.intermediateSteps.push(step);
            
            // If we have a pending step from before, emit it now
            // (We know it's not the final answer since we got another message)
            const request = this.pendingRequests.get(currentResponse.requestId);
            if (request && request.onStep && currentResponse.pendingStep && !process.env.AISH_QUIET) {
              request.onStep(currentResponse.pendingStep);
              currentResponse.pendingStep = null;
            }
            
            // Store this step as pending - we'll emit it if another message comes
            currentResponse.pendingStep = step;
          }
          
          // Messages with non-null stop_reason are truly final (but this seems rare in stream-json)
          if (message.message.stop_reason && message.message.stop_reason !== null) {
            if (process.env.AISH_DEBUG) {
              console.log(chalk.gray(`[DEBUG] Got message with non-null stop_reason: ${message.message.stop_reason}`));
            }
            
            if (currentResponse.requestId !== null) {
              const request = this.pendingRequests.get(currentResponse.requestId);
              if (request) {
                const finalResponse = {
                  content: currentResponse.content,
                  toolUses: currentResponse.toolUses,
                  intermediateSteps: currentResponse.intermediateSteps
                };
                
                request.resolve(finalResponse);
                this.pendingRequests.delete(currentResponse.requestId);
                
                // Reset for next response
                currentResponse = {
                  requestId: null,
                  content: '',
                  toolUses: [],
                  intermediateSteps: [],
                  isComplete: false,
                  pendingStep: null
                };
              }
            }
          }
        } else if (message.type === 'result') {
          // Result message indicates the end of the session
          if (process.env.AISH_DEBUG) {
            if (message.subtype === 'success') {
              console.log(chalk.gray(`[DEBUG] Session complete: ${message.num_turns} turns, ${message.duration_ms}ms, cost: $${message.total_cost_usd}`));
            } else if (message.is_error) {
              console.log(chalk.gray(`[DEBUG] Session error: ${message.subtype}`));
            }
          }
          
          // If we still have a pending request when result arrives, resolve it with what we have
          // This handles cases where we only get intermediate messages (stop_reason: null)
          if (currentResponse.requestId !== null) {
            const request = this.pendingRequests.get(currentResponse.requestId);
            if (request) {
              if (process.env.AISH_DEBUG) {
                console.log(chalk.gray(`[DEBUG] Resolving with accumulated content on result message`));
                console.log(chalk.gray(`[DEBUG] Final accumulated content: ${currentResponse.content?.substring(0, 100)}...`));
              }
              
              // The pending step (if any) is the final answer, so don't emit it as a step
              if (process.env.AISH_DEBUG) {
                if (currentResponse.pendingStep) {
                  console.log(chalk.gray('[DEBUG] Not emitting pending step as it is the final answer'));
                }
                console.log(chalk.gray(`[DEBUG] Total intermediate steps: ${currentResponse.intermediateSteps.length}`));
              }
              
              // Prepare final response with accumulated content
              const finalResponse = {
                content: currentResponse.content,
                toolUses: currentResponse.toolUses,
                intermediateSteps: currentResponse.intermediateSteps
              };
              
              request.resolve(finalResponse);
              this.pendingRequests.delete(currentResponse.requestId);
              
              // Reset current response
              currentResponse = {
                requestId: null,
                content: '',
                toolUses: [],
                intermediateSteps: [],
                isComplete: false,
                pendingStep: null
              };
            }
          }
          
          // Log errors
          if (message.is_error) {
            console.error('Claude session error:', message.subtype);
          }
        }
      }
    } catch (error) {
      console.error('Stream processing error:', error);
      this.isConnected = false;
      this.emit('disconnected');
    }
  }

  extractTextContent(message) {
    if (!message || !message.content) return '';
    
    // Handle different content formats
    if (typeof message.content === 'string') {
      return message.content;
    }
    
    if (Array.isArray(message.content)) {
      return message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
    }
    
    return '';
  }

  findRequestForResponse(content) {
    // Simple heuristic: return the oldest pending request
    // In a more sophisticated implementation, you might match based on content
    for (const [id, request] of this.pendingRequests) {
      return id;
    }
    return null;
  }

  async sendMessage(prompt, onStep) {
    if (!this.isConnected) {
      throw new Error('Claude is not connected');
    }

    // Debug mode logging
    if (process.env.AISH_DEBUG) {
      console.log(chalk.gray('\n[DEBUG] Sending to Claude:'));
      console.log(chalk.gray(prompt));
      console.log(chalk.gray('---'));
    }

    const requestId = this.requestIdCounter++;
    
    // Create a promise that will be resolved when we get a response
    const responsePromise = new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject, onStep });
      
      // Set a timeout
      const timeoutMs = this.config.ai?.timeout_seconds * 1000 || 60000;
      if (process.env.AISH_DEBUG) {
        console.log(chalk.gray(`[DEBUG] Setting timeout to ${timeoutMs}ms (${timeoutMs/1000}s)`));
      }
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timed out'));
        }
      }, timeoutMs);
    });

    // Create the user message
    const userMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: prompt
      },
      parent_tool_use_id: null,
      session_id: this.sessionId || 'initial'
    };

    // Add to queue and notify
    this.messageQueue.push(userMessage);
    this.emit('messageQueued');

    // Wait for response
    return await responsePromise;
  }

  async askQuestion(context, onStep) {
    let prompt;
    
    // Initialize context on first query
    if (!this.contextInitialized) {
      this.systemContext = {
        os: context.os,
        shell: context.shell
      };
      prompt = `You are helping a user in a shell environment. Be helpful and concise.
Operating system: ${context.os}
Shell: ${context.shell}
Current directory: ${context.cwd}

Question: ${context.query}`;
      this.contextInitialized = true;
      this.lastCwd = context.cwd;
    } else {
      // Only send updates for subsequent queries
      prompt = `New question: ${context.query}`;
      if (context.cwd !== this.lastCwd) {
        prompt += `\nCurrent directory: ${context.cwd}`;
        this.lastCwd = context.cwd;
      }
    }

    try {
      const result = await this.sendMessage(prompt, onStep);
      // Handle the new response format
      if (typeof result === 'object' && result !== null && result.content) {
        return { 
          content: String(result.content).trim(), 
          toolUses: result.toolUses || [],
          intermediateSteps: result.intermediateSteps || []
        };
      }
      // Fallback for simple string responses (shouldn't happen with new format)
      const content = result != null ? String(result).trim() : '';
      return { content, toolUses: [], intermediateSteps: [] };
    } catch (error) {
      throw new Error('Failed to answer question: ' + error.message);
    }
  }

  async generateCommand(context) {
    let prompt;
    
    // Initialize context on first query
    if (!this.contextInitialized) {
      this.systemContext = {
        os: context.os,
        shell: context.shell
      };
      prompt = `You are helping a user generate shell commands. Respond with ONLY the command, no explanation.
Operating system: ${context.os}
Shell: ${context.shell}
Current directory: ${context.cwd}

Request: ${context.query}`;
      this.contextInitialized = true;
      this.lastCwd = context.cwd;
    } else {
      // Only send updates for subsequent queries
      prompt = `New command request: ${context.query}`;
      if (context.cwd !== this.lastCwd) {
        prompt += `\nCurrent directory: ${context.cwd}`;
        this.lastCwd = context.cwd;
      }
    }

    try {
      const result = await this.sendMessage(prompt);
      // Handle the new response format
      if (typeof result === 'object' && result !== null && result.content) {
        return String(result.content).trim();
      }
      // Fallback for simple string responses
      return result != null ? String(result).trim() : '';
    } catch (error) {
      throw new Error('Failed to generate command: ' + error.message);
    }
  }

  async processSubstitution(context) {
    // Create a single prompt for all substitutions to avoid multiple rapid requests
    const substitutionPairs = context.substitutions.map(s => ({
      original: s.full,
      text: s.text
    }));
    
    const prompt = `Convert these natural language descriptions to shell command fragments and provide the complete command.

Original command: ${context.command}
Current directory: ${context.cwd}

Substitutions needed:
${substitutionPairs.map((s, i) => `${i + 1}. Replace "${s.original}" with the shell command for: "${s.text}"`).join('\n')}

Provide the final command with all substitutions applied. Respond with ONLY the complete command:`;
    
    try {
      const result = await this.sendMessage(prompt);
      let finalCommand;
      if (typeof result === 'object' && result !== null && result.content) {
        finalCommand = String(result.content).trim();
      } else {
        finalCommand = result != null ? String(result).trim() : '';
      }
      
      return finalCommand;
    } catch (error) {
      throw new Error(`Failed to process substitutions: ${error.message}`);
    }
  }

  async suggestCorrection(context) {
    const prompt = `The following shell command failed. Suggest a correction.

Command: ${context.command}
Exit code: ${context.exitCode}
Error output: ${context.stderr || 'No error output'}
Current directory: ${context.cwd}

Respond with ONLY the corrected command, or the same command if no correction is needed:`;

    try {
      const result = await this.sendMessage(prompt);
      // Handle the new response format
      let suggestion;
      if (typeof result === 'object' && result !== null && result.content) {
        suggestion = String(result.content).trim();
      } else {
        suggestion = result != null ? String(result).trim() : '';
      }
      // Only return if it's different from the original
      return suggestion !== context.command ? suggestion : null;
    } catch (error) {
      // Silently fail for error correction
      return null;
    }
  }

  async disconnect() {
    this.isConnected = false;
    this.emit('messageQueued'); // Trigger the input stream to exit
    
    if (this.queryStream && this.queryStream.interrupt) {
      await this.queryStream.interrupt();
    }
    
    // Clear pending requests
    for (const [id, request] of this.pendingRequests) {
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    
    this.sessionId = null;
  }
}