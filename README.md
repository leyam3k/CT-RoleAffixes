# Rentry

https://rentry.org/noass_ext

# Installation

Extensions -> Install extension (top right) -> Insert link `https://gitgud.io/Monblant/noass`

# Settings

`Enable NoAss` - enables messages squashing.

`Enable Insertable Prefill` - enables Insertable Prefill to be inserted at the prompt and at the beginning of a message.

`Separate Chat History` - always places squashed Chat History in a separate message

`Squash Role` - the role from which the squashed chat history will be sent. Default - Assistant.

`Stop String` - Provides three configurable variants for stopping generation. Each variant has its own settings:
- `Variant Selector`: A dropdown to switch between the three stop string variants.
- `Value`: The actual string or regex pattern to stop generation.
- `Client-Only`: Toggles whether the stop string is detected on the client side.
- `Regex`: Toggles whether the value should be treated as a regular expression (only works with Client-Only enabled).

`Response Max Symbols` - limits the maximum number of characters in a response. If exceeded, the response will be truncated to the last line break encountered.

`Messages Separator` - characters to be used to separate messages. The default is `Double newline`.

`Squashed History Separator` - Provides three configurable variants for post-processing squashed messages. Each variant contains its own settings for splitting the history and inserting prompts.
- `Variant Selector`: A dropdown to switch between the three post-processing variants.
- `Enable Squashed History Separator`: Enables or disables this entire post-processing block for the selected variant.
- `Keep Separator`: Keeps the separator string in the message below after splitting.
- `Regex Mode`: Treats the separator string as a regular expression.
- `Separator String`: The string or regex pattern used to split the squashed history into multiple messages.
- `Enable Inter-Split Prompt`: Enables the insertion of a custom prompt between the newly split messages.
- `Prompt Role`: The role (System, User, Assistant) from which the inter-split prompt will be sent.
- `Prompt Content`: The text content of the inter-split prompt.

`User Prefix` - a string to be placed before the user message. The default is `**{{{user}}:** ` (with a space).

`User Suffix` - a string to be placed after the user message.

`Char Prefix` - a string to be placed before the char message.

`Char Suffix` - a string to be placed after the char message.

`Insertable Prefill` - a string to placed after the chat history.

# Depth Prompts

In the extension, it is possible to insert prompts as separate messages in depth of squashed Chat History. To do this, add prefix `[NoAssDepth]` to the prompt's name and turn the prompt on in the Prompt Manager.

NOTE 1: Don't use regular depth prompts and NoAss depth prompts at the same depth. This will result in undefined behavior.

NOTE 2: Don't create NoAss depth prompts with different roles at the same depth. They will take the role of the first of the prompts.
