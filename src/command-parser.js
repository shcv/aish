export class CommandParser {
  constructor(config) {
    this.config = config;
    this.substitutionPattern = /~\{([^}]+)\}/g;
  }

  parse(input) {
    const trimmed = input.trim();

    // Check for AI question (just get an answer)
    if (trimmed.startsWith('?')) {
      return {
        type: 'ai_question',
        query: trimmed.slice(1).trim()
      };
    }

    // Check for natural language command generation
    if (trimmed.startsWith('!')) {
      return {
        type: 'natural_language',
        query: trimmed.slice(1).trim()
      };
    }

    // Check for substitutions
    const substitutions = [];
    let match;
    while ((match = this.substitutionPattern.exec(trimmed)) !== null) {
      substitutions.push({
        full: match[0],
        text: match[1],
        start: match.index,
        end: match.index + match[0].length
      });
    }

    if (substitutions.length > 0) {
      return {
        type: 'substitution',
        command: trimmed,
        substitutions
      };
    }

    // Regular command
    return {
      type: 'regular',
      command: trimmed
    };
  }
}