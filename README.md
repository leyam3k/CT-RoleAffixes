# CT-RoleAffixes

A minimal SillyTavern/CozyTavern extension for adding prefixes and suffixes to user and character messages in Chat Completion mode.

## Features

- **Messages Separator**: Choose how messages are separated (Double Newline, Newline, or Space)
- **User Prefix/Suffix**: Add custom text before/after user messages
- **Char Prefix/Suffix**: Add custom text before/after character messages
- **Insertable Prefill**: Add prefill text that gets inserted at the end of the prompt and prepended to responses

## Installation

Extensions → Install extension (top right) → Insert link to this repository

## Settings

### Enable Role Affixes

Enables the extension's message processing.

### Messages Separator

Characters used to separate messages when squashing chat history:

- **Double Newline** (default): `\n\n`
- **Newline**: `\n`
- **Space**: ` `

### User Prefix

Text placed before each user message. Use `\n` for newlines.
Default: `**{{user}}:** `

### User Suffix

Text placed after each user message. Use `\n` for newlines.

### Char Prefix

Text placed before each character message. Use `\n` for newlines.

### Char Suffix

Text placed after each character message. Use `\n` for newlines.

### Insertable Prefill

When enabled, this text is:

1. Added as an assistant message at the end of the prompt
2. Prepended to the AI's response

Useful for starting responses with specific formatting or characters.

## Macro Support

All prefix/suffix fields support SillyTavern macros including:

- `{{user}}` - User's name
- `{{char}}` - Character's name
- `{{timestamp}}` - Message timestamp

## Requirements

- SillyTavern version 1.12 or higher
- Chat Completion API (OpenAI-compatible endpoints)

## Credits

Based on the NoAss extension by Monblant. Simplified for CozyTavern with focus on affix functionality only.
