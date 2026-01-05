import {
  saveSettingsDebounced,
  substituteParams,
  chat,
  this_chid,
  updateMessageBlock,
} from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";
import { promptManager, Message, MessageCollection } from "../../../openai.js";
import { getMessageTimeStamp } from "../../../RossAscends-mods.js";

const { eventSource, event_types, renderExtensionTemplateAsync, saveChat } =
  SillyTavern.getContext();

const defaultSettings = {
  enabled: false,
  messages_separator: "double_newline",
  user_prefix: "**{{user}}:** ",
  user_suffix: "",
  char_prefix: "",
  char_suffix: "",
  prefill: "",
  enable_prefill: false,
};

const MessageRole = {
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
};

const extensionName = "CT-RoleAffixes";
const extensionPrefix = "[RoleAffixes]";
const path = "third-party/CT-RoleAffixes";

let unhiddenChat;

function getDefaultSettings() {
  return JSON.parse(JSON.stringify(defaultSettings));
}

function checkSettings() {
  if (!extension_settings.RoleAffixes) {
    extension_settings.RoleAffixes = getDefaultSettings();
  }

  const settings = extension_settings.RoleAffixes;

  // Ensure all default properties exist
  for (const key of Object.keys(defaultSettings)) {
    if (settings[key] === undefined) {
      settings[key] = defaultSettings[key];
    }
  }

  saveSettingsDebounced();
}

function loadSettingsUI() {
  const settings = extension_settings.RoleAffixes;
  const replaceNewlines = (str) => (str ? str.replace(/\n/g, "\\n") : "");

  $("#roleaffixes_enabled").prop("checked", settings.enabled);
  $("#roleaffixes_enable_prefill").prop("checked", settings.enable_prefill);
  $("#roleaffixes_messages_separator").val(settings.messages_separator);
  $("#roleaffixes_user_prefix").val(replaceNewlines(settings.user_prefix));
  $("#roleaffixes_user_suffix").val(replaceNewlines(settings.user_suffix));
  $("#roleaffixes_char_prefix").val(replaceNewlines(settings.char_prefix));
  $("#roleaffixes_char_suffix").val(replaceNewlines(settings.char_suffix));
  $("#roleaffixes_prefill").val(settings.prefill);
}

function setupListeners() {
  const settings = extension_settings.RoleAffixes;

  $("#roleaffixes_enabled")
    .off("click")
    .on("click", () => {
      settings.enabled = $("#roleaffixes_enabled").prop("checked");
      saveSettingsDebounced();
    });

  $("#roleaffixes_enable_prefill")
    .off("click")
    .on("click", () => {
      settings.enable_prefill = $("#roleaffixes_enable_prefill").prop(
        "checked"
      );
      saveSettingsDebounced();
    });

  $("#roleaffixes_messages_separator")
    .off("change")
    .on("change", () => {
      settings.messages_separator = $("#roleaffixes_messages_separator").val();
      saveSettingsDebounced();
    });

  const inputListeners = [
    {
      selector: "#roleaffixes_user_prefix",
      key: "user_prefix",
      replaceNewlines: true,
    },
    {
      selector: "#roleaffixes_user_suffix",
      key: "user_suffix",
      replaceNewlines: true,
    },
    {
      selector: "#roleaffixes_char_prefix",
      key: "char_prefix",
      replaceNewlines: true,
    },
    {
      selector: "#roleaffixes_char_suffix",
      key: "char_suffix",
      replaceNewlines: true,
    },
    {
      selector: "#roleaffixes_prefill",
      key: "prefill",
      replaceNewlines: false,
    },
  ];

  inputListeners.forEach(({ selector, key, replaceNewlines }) => {
    $(selector)
      .off("input")
      .on("input", () => {
        let value = $(selector).val();
        if (replaceNewlines) value = value.replace(/\\n/g, "\n");
        settings[key] = value;
        saveSettingsDebounced();
      });
  });
}

// Check if we're in Chat Completion mode
function isChatCompletion() {
  return SillyTavern.getContext().mainApi === "openai";
}

// Get send date for timestamp macro support
function getSendDate(idx) {
  if (idx !== undefined && idx < unhiddenChat.length) {
    return this_chid ? unhiddenChat[idx]?.send_date : "";
  }
  return getMessageTimeStamp();
}

// Convert Message/MessageCollection to plain chat array
function getChat(messages) {
  const assembled_chat = [];
  for (let item of messages) {
    if (item instanceof MessageCollection) {
      assembled_chat.push(...item.getChat());
    } else if (
      item instanceof Message &&
      (item.content !== undefined || item.tool_calls)
    ) {
      const message = {
        role: item.role,
        content: item.content,
        ...(item.name ? { name: item.name } : {}),
        ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
        ...(item.role === "tool" ? { tool_call_id: item.identifier } : {}),
      };
      assembled_chat.push(message);
    }
  }
  return assembled_chat;
}

// Split the messages array into before/chat history/after sections
function splitArrayByChatHistory(arr) {
  if (!Array.isArray(arr)) {
    return [[], [], []];
  }

  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < arr.length; i++) {
    if (!arr[i]) {
      continue;
    } else if (
      typeof arr[i].identifier === "string" &&
      arr[i].identifier.includes("chatHistory")
    ) {
      if (startIndex === -1) {
        startIndex = i;
      }
      endIndex = i;
    } else if (startIndex !== -1) {
      break;
    }
  }

  if (startIndex === -1) {
    return [arr, [], []];
  }

  const before = arr.slice(0, startIndex);
  const chatHistory = arr.slice(startIndex, endIndex + 1);
  const after = arr.slice(endIndex + 1);

  return [before, chatHistory, after];
}

// Filter undefined elements from array
function filterUndefined(arr) {
  return arr.filter((element) => element !== undefined);
}

// Filter messages with empty content
function filterEmptyContentMessages(arr) {
  return arr.filter((element) => element.content !== "");
}

// Merge consecutive messages with the same role
function mergeMessagesByRole(messages, separator) {
  const mergedMessages = [];
  if (messages.length === 0) {
    return mergedMessages;
  }

  mergedMessages.push({ ...messages[0] });

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === mergedMessages[mergedMessages.length - 1].role) {
      if (mergedMessages[mergedMessages.length - 1].content === "") {
        mergedMessages[mergedMessages.length - 1].content = messages[i].content;
      } else if (messages[i].content === "" && i !== messages.length - 1) {
        continue;
      } else {
        mergedMessages[mergedMessages.length - 1].content +=
          separator + messages[i].content;
      }
    } else {
      mergedMessages.push({ ...messages[i] });
    }
  }

  return mergedMessages;
}

// Validate required event types
if (!("CHAT_COMPLETION_PROMPT_READY" in event_types)) {
  toastr.error(
    `${extensionName}: Required event type CHAT_COMPLETION_PROMPT_READY not found. Update SillyTavern to version >=1.12.`
  );
  throw new Error("Required event type not found.");
}

// Main prompt processing handler
eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
  const settings = extension_settings.RoleAffixes;

  if (!settings.enabled || !isChatCompletion() || this_chid === undefined)
    return;

  console.debug(`${extensionPrefix} Processing prompt with affixes`);

  const separator =
    { newline: "\n", space: " " }[settings.messages_separator] || "\n\n";

  const messages = filterUndefined([...promptManager.messages.collection]);
  const [beforeChatRaw, chatHistoryRaw, afterChatRaw] =
    splitArrayByChatHistory(messages);

  const chatHistory = mergeMessagesByRole(getChat(chatHistoryRaw), separator);
  const baseOffset = unhiddenChat.length - chatHistory.length;

  // Apply affixes to chat history messages
  function applyAffixes(chatHistoryPart, idxOffset) {
    const processed = chatHistoryPart.reduce((history, message, idx) => {
      let prefix = "";
      let suffix = "";
      const chatIndex = Math.max(0, baseOffset + idxOffset + idx);
      const timestampDict = { timestamp: getSendDate(chatIndex) };

      switch (message.role) {
        case MessageRole.USER:
          prefix = substituteParams(settings.user_prefix, {
            dynamicMacros: timestampDict,
          });
          suffix = substituteParams(settings.user_suffix, {
            dynamicMacros: timestampDict,
          });
          break;
        case MessageRole.ASSISTANT:
          prefix = substituteParams(settings.char_prefix, {
            dynamicMacros: timestampDict,
          });
          suffix = substituteParams(settings.char_suffix, {
            dynamicMacros: timestampDict,
          });
          break;
        default:
          prefix = "";
          suffix = "";
      }

      if (history === "") {
        return `${prefix}${message.content.trim()}${suffix}`;
      } else {
        return `${history}${separator}${prefix}${message.content.trim()}${suffix}`;
      }
    }, "");

    return {
      role: MessageRole.ASSISTANT,
      content: processed,
    };
  }

  const squashedChatHistory = applyAffixes(chatHistory, 0);

  const beforeChat = getChat(beforeChatRaw);
  const afterChat = getChat(afterChatRaw);

  // Add prefill if enabled
  if (settings.enable_prefill && settings.prefill) {
    afterChat.push({
      role: MessageRole.ASSISTANT,
      content: substituteParams(settings.prefill),
    });
  }

  // Reassemble the final chat
  const reassembledChat = mergeMessagesByRole(
    [...beforeChat, squashedChatHistory, ...afterChat],
    separator
  );
  const finalChat = mergeMessagesByRole(
    filterEmptyContentMessages(reassembledChat),
    separator
  );

  // Replace the data.chat array
  data.chat.length = 0;
  for (let idx = 0; idx < finalChat.length; idx++) {
    data.chat.push({ ...finalChat[idx] });
  }

  console.debug(`${extensionPrefix} Prompt processed successfully`);
});

// Handle prefill insertion into received messages
eventSource.makeFirst(event_types.MESSAGE_RECEIVED, async (messageId) => {
  const settings = extension_settings.RoleAffixes;

  if (
    !settings.enabled ||
    !isChatCompletion() ||
    messageId === 0 ||
    this_chid === undefined
  )
    return;

  // Prepend prefill to message if enabled
  if (
    settings.enable_prefill &&
    settings.prefill &&
    !["...", ""].includes(chat[messageId]?.mes)
  ) {
    const prefill = substituteParams(settings.prefill);
    if (prefill && !chat[messageId].mes.startsWith(prefill)) {
      chat[messageId].mes = prefill + chat[messageId].mes;
      if (chat[messageId].swipes) {
        chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
      }
      updateMessageBlock(messageId, chat[messageId], { rerenderMessage: true });
      await saveChat();
    }
  }
});

// Update unhiddenChat when chat changes
eventSource.makeFirst(event_types.CHAT_CHANGED, () => {
  if (!extension_settings.RoleAffixes?.enabled || this_chid === undefined)
    return;
  unhiddenChat = chat.filter((message) => message.is_system !== true) ?? [];
});

// Initialize the extension
jQuery(async () => {
  $("#extensions_settings").append(
    await renderExtensionTemplateAsync(path, "settings")
  );
  checkSettings();
  loadSettingsUI();
  setupListeners();
  console.log(`${extensionPrefix} Extension loaded`);
});
