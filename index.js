import { saveSettingsDebounced, substituteParams, chat, this_chid, stopGeneration, updateMessageBlock } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { addEphemeralStoppingString, flushEphemeralStoppingStrings } from '../../../power-user.js';
import { download, getFileText } from '../../../utils.js';
import { promptManager, Message, MessageCollection, oai_settings } from '../../../openai.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';

const { eventSource, event_types, callPopup, renderExtensionTemplateAsync, saveChat } = SillyTavern.getContext();

const defaultSeparator = {
    enable: false,
    string: '',
    keep: false,
    regex: false,
    prompt_enable: false,
    prompt_role: 'user',
    prompt_string: '→',
};

const defaultSet = {
    name: 'Default',
    enable_stop_string: true,
    stop_strings: [
        { value: '**{{user}}:**', client: false, regex: false },
        { value: '', client: false, regex: false },
        { value: '', client: false, regex: false },
    ],
    stop_string_selection: 0,
    max_symbols: 999999,
    messages_separator: 'double_newline',
    user_prefix: '**{{user}}:** ',
    user_suffix: '',
    char_prefix: '',
    char_suffix: '',
    zero_prefill: '',
    enable_zero_prefill: false,
    separate_chat_history: false,
    squash_role: 'assistant',
    squashed_separator_selection: 0,
    squashed_separators: [
        { ...defaultSeparator },
        { ...defaultSeparator },
        { ...defaultSeparator },
    ],
};

const defaultSettings = {
    noass_is_enabled: false,
    active_set: 'Default',
    active_set_idx: 0,
    sets: [getDefaultSet()]
};

const MessageRole = {
    SYSTEM: 'system',
    USER: 'user',
    ASSISTANT: 'assistant'
}

const defaultExtPrefix = '[NoAss]';
const depthPromptPrefix = '[NoAssDepth]'
const path = 'third-party/noass';

let cachedStopString;
let cachedMaxSymbols;
let clientStopStringTriggered = false;
let maxSymbolsReached = false;
let isSteaming = false;
let unhiddenChat;

function getDefaultSet() {
    return JSON.parse(JSON.stringify(defaultSet));
}

function updateOrInsert(jsonArray, newJson) {
    const index = jsonArray.findIndex(item => item.name === newJson.name);
    if (index !== -1) {
        jsonArray[index] = newJson;
        return index;
    } else {
        jsonArray.push(newJson);
        return jsonArray.length - 1;
    }
}

function removeAfterSubstring(str, substring) {
    const index = str.indexOf(substring);
    if (index === -1) {
        return str;
    }
    return str.slice(0, index);
}

function removeAfterLastNewline(str) {
    const lastNewlineIndex = str.lastIndexOf('\n');
    let stringToTrim;

    if (lastNewlineIndex !== -1) {
        stringToTrim = str.slice(0, lastNewlineIndex + 1);
    } else {
        stringToTrim = str;
    }

    return stringToTrim.trimEnd();
}

function removeAfterRegexMatch(str, regex) {
    const match = regex.exec(str);
    if (match) {
        return str.slice(0, match.index);
    }
    return str;
}

function stringToRegExp(str) {
    try {
        if (str.startsWith('/')) {
            const lastSlash = str.lastIndexOf('/');
            if (lastSlash > 0) {
                const pattern = str.substring(1, lastSlash);
                const flags = str.substring(lastSlash + 1);
                const validFlags = 'gimyus';
                for (const char of flags) {
                    if (!validFlags.includes(char)) {
                        return new RegExp(str);
                    }
                }
                return new RegExp(pattern, flags);
            }
        }
        return new RegExp(str);
    } catch (error) {
        console.error("Error converting string to RegExp:", error);
        return null;
    }
}

function clientStopStringHandler(text, shouldStop = true) {
    const activeSet = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx];
    const selection = activeSet.stop_string_selection ?? 0;
    const selectedStopString = activeSet.stop_strings[selection];

    if (selectedStopString.client && activeSet.enable_stop_string) {
        if (cachedStopString === undefined) {
            const { value: stop_string } = selectedStopString;

            if (stop_string) {
                cachedStopString = substituteParams(stop_string);
                if (selectedStopString.regex) {
                    cachedStopString = stringToRegExp(cachedStopString);
                }
            }
        }

        const stopStringTriggered = !selectedStopString.regex && text.includes(cachedStopString);
        const stopRegexTriggered = selectedStopString.regex && cachedStopString && cachedStopString.test && cachedStopString.test(text);

        if (stopStringTriggered || stopRegexTriggered) {
            clientStopStringTriggered = true;
            if (shouldStop) {
                stopGeneration();
            }
        }
    }
}

function refreshSetList() {
    const setsName = extension_settings.NoAss.sets.map(obj => obj.name);
    const $presetList = $('#NoAss-preset-list').empty();
    setsName.forEach(option => {
        $presetList.append($('<option>', { value: option, text: option }));
    });
    $presetList.val(extension_settings.NoAss.active_set);
}


async function changeSet(idx) {
    const set_name = extension_settings.NoAss.sets[idx].name;
    extension_settings.NoAss.active_set = set_name;
    extension_settings.NoAss.active_set_idx = idx;
    refreshSetList();
    loadSetParameters();
    saveSettingsDebounced();
}

async function importSet(file) {
    if (!file) {
        toastr.error('No file provided.');
        return;
    }

    try {
        const fileText = await getFileText(file);
        const noAssSet = JSON.parse(fileText);
        if (!noAssSet.name) throw new Error('No name provided.');

        const setIdx = updateOrInsert(extension_settings.NoAss.sets, noAssSet);
        await changeSet(setIdx);
        checkSettings();
        loadSetParameters();
        toastr.success(`NoAss set "${noAssSet.name}" imported.`);
    } catch (error) {
        console.error(error);
        toastr.error('Invalid JSON file.');
    }
}

function importSetFromObject(setObject) {
    if (!setObject.name) {
        return false;
    } else {
        updateOrInsert(extension_settings.NoAss.sets, setObject);
        checkSettings();
        loadSetParameters();
        return true;
    }
}

function checkSettings() {
    const noAssSettings = extension_settings.NoAss;

    noAssSettings.noass_is_enabled = noAssSettings.noass_is_enabled ?? defaultSettings.noass_is_enabled;
    noAssSettings.sets = Array.isArray(noAssSettings.sets) ? noAssSettings.sets : [];
    if (noAssSettings.sets.length === 0) {
        noAssSettings.sets.push(getDefaultSet());
    }
    noAssSettings.active_set_idx = (typeof noAssSettings.active_set_idx === 'number' && noAssSettings.active_set_idx >= 0) ? noAssSettings.active_set_idx : 0;

    for (let i = 0; i < noAssSettings.sets.length; i++) {
        if (typeof noAssSettings.sets[i] !== 'object' || noAssSettings.sets[i] === null) {
            noAssSettings.sets[i] = getDefaultSet();
            if (noAssSettings.sets[i].name === defaultSet.name) {
                 const existingNames = noAssSettings.sets.map(s => s.name);
                 let newName = defaultSet.name;
                 let counter = 1;
                 while(existingNames.includes(newName)) {
                     newName = `${defaultSet.name} ${counter++}`;
                 }
                 noAssSettings.sets[i].name = newName;
            }
        }
        let currentSet = noAssSettings.sets[i];

        if (typeof currentSet.name !== 'string' || currentSet.name.trim() === '') {
            currentSet.name = `Set ${i + 1}`;
        }

        for (const key of Object.keys(defaultSet)) {
            if (currentSet[key] === undefined) {
                if (noAssSettings[key] !== undefined) {
                    currentSet[key] = noAssSettings[key];
                } else {
                    currentSet[key] = defaultSet[key];
                }
            }
        }

        if (currentSet.enable_squashed_separator !== undefined) {
            currentSet.squashed_separators = [
                {
                    enable: currentSet.enable_squashed_separator,
                    string: currentSet.squashed_separator_string,
                    keep: currentSet.squashed_separator_keep,
                    regex: currentSet.squashed_separator_regex,
                    prompt_enable: currentSet.squashed_separator_prompt_enable,
                    prompt_role: currentSet.squashed_separator_prompt_role,
                    prompt_string: currentSet.squashed_separator_prompt_string,
                },
                { ...defaultSeparator },
                { ...defaultSeparator },
            ];
            currentSet.squashed_separator_selection = 0;
        
            delete currentSet.enable_squashed_separator;
            delete currentSet.squashed_separator_string;
            delete currentSet.squashed_separator_keep;
            delete currentSet.squashed_separator_regex;
            delete currentSet.squashed_separator_prompt_enable;
            delete currentSet.squashed_separator_prompt_role;
            delete currentSet.squashed_separator_prompt_string;
        }

        if (typeof currentSet.stop_string === 'string') {
            currentSet.stop_strings = [
                {
                    value: currentSet.stop_string,
                    client: currentSet.client_stop_string ?? false,
                    regex: currentSet.client_stop_regex ?? false,
                },
                { value: '', client: false, regex: false },
                { value: '', client: false, regex: false },
            ];
            currentSet.stop_string_selection = 0;

            delete currentSet.stop_string;
            delete currentSet.client_stop_string;
            delete currentSet.client_stop_regex;
        }
    }

    for (const key of Object.keys(defaultSet)) {
        delete noAssSettings[key];
    }

    if (noAssSettings.active_set_idx >= noAssSettings.sets.length || noAssSettings.active_set_idx < 0) {
        noAssSettings.active_set_idx = 0;
    }

    if (noAssSettings.sets.length === 0) {
        noAssSettings.sets.push(getDefaultSet());
        noAssSettings.active_set_idx = 0;
    }
    
    if (noAssSettings.sets[noAssSettings.active_set_idx] && noAssSettings.sets[noAssSettings.active_set_idx].name) {
        noAssSettings.active_set = noAssSettings.sets[noAssSettings.active_set_idx].name;
    } else {
        noAssSettings.active_set_idx = 0;
        noAssSettings.active_set = noAssSettings.sets[0].name;
    }
    
    let foundActiveSetByName = noAssSettings.sets.findIndex(s => s.name === noAssSettings.active_set);
    if (foundActiveSetByName !== -1) {
        noAssSettings.active_set_idx = foundActiveSetByName;
    } else {
        if (noAssSettings.sets[noAssSettings.active_set_idx]) {
            noAssSettings.active_set = noAssSettings.sets[noAssSettings.active_set_idx].name;
        } else {
            noAssSettings.active_set_idx = 0;
            noAssSettings.active_set = noAssSettings.sets[0].name;
        }
    }

    saveSettingsDebounced();
}

function loadSetParameters() {
    const currentSet = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx];
    const replaceNewlines = str => str ? str.replace(/\n/g, '\\n') : '';

    $('#noass_is_enabled').prop('checked', extension_settings.NoAss.noass_is_enabled);
    $('#noass_enable_zero_prefill').prop('checked', currentSet.enable_zero_prefill);
    $('#noass_separate_chat_history').prop('checked', currentSet.separate_chat_history);
    $('#noass_squash_role').val(currentSet.squash_role);
    $('#noass_enable_stop_string').prop('checked', currentSet.enable_stop_string);
    $('#noass_stop_string_selection').val(currentSet.stop_string_selection ?? 0);
    const selectedStopString = currentSet.stop_strings[currentSet.stop_string_selection ?? 0];
    $('#noass_client_stop_string').prop('checked', selectedStopString.client);
    $('#noass_client_stop_regex').prop('checked', selectedStopString.regex);
    $('#noass_stop_string').val(selectedStopString.value);
    $('#noass_max_symbols').val(currentSet.max_symbols);
    $('#noass_messages_separator').val(currentSet.messages_separator);
    $('#noass_user_prefix').val(replaceNewlines(currentSet.user_prefix));
    $('#noass_user_suffix').val(replaceNewlines(currentSet.user_suffix));
    $('#noass_char_prefix').val(replaceNewlines(currentSet.char_prefix));
    $('#noass_char_suffix').val(replaceNewlines(currentSet.char_suffix));
    $('#noass_zero_prefill').val(currentSet.zero_prefill);
    const selectedSeparator = currentSet.squashed_separators[currentSet.squashed_separator_selection ?? 0];
    $('#noass_squashed_separator_selection').val(currentSet.squashed_separator_selection ?? 0);
    $('#noass_enable_squashed_separator').prop('checked', selectedSeparator.enable);
    $('#noass_squashed_separator_string').val(selectedSeparator.string);
    $('#noass_squashed_separator_keep').prop('checked', selectedSeparator.keep);
    $('#noass_squashed_separator_regex').prop('checked', selectedSeparator.regex);
    $('#noass_squashed_separator_prompt_enable').prop('checked', selectedSeparator.prompt_enable);
    $('#noass_squashed_separator_prompt_role').val(selectedSeparator.prompt_role);
    $('#noass_squashed_separator_prompt_string').val(selectedSeparator.prompt_string);
}

function loadSettings() {
    if (!extension_settings.NoAss) {
        extension_settings.NoAss = defaultSettings;
    };

    checkSettings();
    refreshSetList();
    loadSetParameters();
}

function setupListeners() {
    const noAssSettings = extension_settings.NoAss;

    $('#noass_is_enabled').off('click').on('click', () => {
        noAssSettings.noass_is_enabled = $('#noass_is_enabled').prop('checked');
        if (!noAssSettings.noass_is_enabled) flushEphemeralStoppingStrings();
        saveSettingsDebounced();
    });

    $('#noass_enable_zero_prefill').off('click').on('click', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].enable_zero_prefill = $('#noass_enable_zero_prefill').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_separate_chat_history').off('click').on('click', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].separate_chat_history = $('#noass_separate_chat_history').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_enable_squashed_separator').off('click').on('click', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separators[selection].enable = $('#noass_enable_squashed_separator').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_squashed_separator_keep').off('click').on('click', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separators[selection].keep = $('#noass_squashed_separator_keep').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_squashed_separator_regex').off('click').on('click', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separators[selection].regex = $('#noass_squashed_separator_regex').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_squashed_separator_prompt_enable').off('click').on('click', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separators[selection].prompt_enable = $('#noass_squashed_separator_prompt_enable').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_squashed_separator_prompt_role').off('change').on('change', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separators[selection].prompt_role = $('#noass_squashed_separator_prompt_role').val();
        saveSettingsDebounced();
    });

    $('#noass_squashed_separator_selection').off('change').on('change', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection = Number($('#noass_squashed_separator_selection').val());
        loadSetParameters();
        saveSettingsDebounced();
    });

    $('#noass_stop_string_selection').off('change').on('change', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].stop_string_selection = Number($('#noass_stop_string_selection').val());
        loadSetParameters();
        saveSettingsDebounced();
    });

    $('#noass_client_stop_string').off('click').on('click', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].stop_string_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].stop_strings[selection].client = $('#noass_client_stop_string').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_client_stop_regex').off('click').on('click', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].stop_string_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].stop_strings[selection].regex = $('#noass_client_stop_regex').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_max_symbols').off('change').on('change', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].max_symbols = $('#noass_max_symbols').val();        
        saveSettingsDebounced();
    });

    $('#noass_squash_role').off('change').on('change', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].squash_role = $('#noass_squash_role').val();
        saveSettingsDebounced();
    });

    $('#NoAss-preset-list').off('change').on('change', async () => {
        await changeSet($('#NoAss-preset-list').prop('selectedIndex'));
    });

    $('#NoAss-preset-new').on('click', async () => {
        const newSetHtml = $(await renderExtensionTemplateAsync(path, 'new_set_popup'));
        const popupResult = await callPopup(newSetHtml, 'confirm', undefined, { okButton: 'Save' });
        if (popupResult) {
            const newSet = getDefaultSet();
            newSet.name = String(newSetHtml.find('.NoAss-newset-name').val());
            const setIdx = updateOrInsert(noAssSettings.sets, newSet);
            await changeSet(setIdx);
        }
    });

    $('#NoAss-preset-importFile').on('change', async function () {
        for (const file of this.files) {
            await importSet(file);
        }
        this.value = '';
    });

    $('#NoAss-preset-import').on('click', () => {
        $('#NoAss-preset-importFile').trigger('click');
    });

    $('#NoAss-preset-export').on('click', () => {
        const currentSet = noAssSettings.sets[noAssSettings.active_set_idx];
        const fileName = `${currentSet.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
        const fileData = JSON.stringify(currentSet, null, 4);
        download(fileData, fileName, 'application/json');
    });

    $('#NoAss-preset-delete').on('click', async () => {
        const confirm = await callPopup('Are you sure you want to delete this set?', 'confirm');
        if (!confirm) return;

        noAssSettings.sets.splice(noAssSettings.active_set_idx, 1);
        if (noAssSettings.sets.length) {
            changeSet(0);
        } else {
            const setIdx = updateOrInsert(noAssSettings.sets, getDefaultSet());
            changeSet(setIdx);
        }
    });

    $('#noass_enable_stop_string').off('click').on('click', () => {
        const value = $('#noass_enable_stop_string').prop('checked');
        if (!value) {
            flushEphemeralStoppingStrings();
        }
        noAssSettings.sets[noAssSettings.active_set_idx].enable_stop_string = value
        saveSettingsDebounced();
    });

    const inputListeners = [
        { selector: '#noass_user_prefix', key: 'user_prefix', replaceNewlines: true },
        { selector: '#noass_user_suffix', key: 'user_suffix', replaceNewlines: true },
        { selector: '#noass_char_prefix', key: 'char_prefix', replaceNewlines: true },
        { selector: '#noass_char_suffix', key: 'char_suffix', replaceNewlines: true },
        { selector: '#noass_zero_prefill', key: 'zero_prefill' },
    ];

    inputListeners.forEach(({ selector, key, replaceNewlines }) => {
        $(selector).off('input').on('input', () => {
            let value = $(selector).val();
            if (replaceNewlines) value = value.replace(/\\n/g, '\n');

            noAssSettings.sets[noAssSettings.active_set_idx][key] = value;
            saveSettingsDebounced();
        });
    });

    $('#noass_squashed_separator_string').off('input').on('input', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separators[selection].string = $('#noass_squashed_separator_string').val();
        saveSettingsDebounced();
    });

    $('#noass_squashed_separator_prompt_string').off('input').on('input', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].squashed_separator_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].squashed_separators[selection].prompt_string = $('#noass_squashed_separator_prompt_string').val();
        saveSettingsDebounced();
    });

    $('#noass_messages_separator').off('change').on('change', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].messages_separator = $('#noass_messages_separator').val();
        saveSettingsDebounced();
    });

    $('#noass_stop_string').off('input').on('input', () => {
        const selection = noAssSettings.sets[noAssSettings.active_set_idx].stop_string_selection ?? 0;
        noAssSettings.sets[noAssSettings.active_set_idx].stop_strings[selection].value = $('#noass_stop_string').val();
        saveSettingsDebounced();
    });
}

if (!('CHAT_COMPLETION_PROMPT_READY' in event_types)) {
    toastr.error('Required event types not found: CHAT_COMPLETION_PROMPT_READY. Update SillyTavern to the >=1.12 version.');
    throw new Error('Events not found.');
}

function isChatCompletion() {
    return SillyTavern.getContext().mainApi === 'openai';
}

function getSendDate(idx) {
    if (idx !== undefined && idx < unhiddenChat.length) {
        return this_chid ? unhiddenChat[idx]?.send_date : '';
    }
    return getMessageTimeStamp();
}

function getChat(messages) {
    const assembled_chat = [];
    for (let item of messages) {
        if (item instanceof MessageCollection) {
            assembled_chat.push(...item.getChat());
        } else if (item instanceof Message && (item.content !== undefined || item.tool_calls)) {
            const message = {
                role: item.role,
                content: item.content,
                ...(item.name ? { name: item.name } : {}),
                ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
                ...(item.role === 'tool' ? { tool_call_id: item.identifier } : {}),
            };
            assembled_chat.push(message);
        } else {
            console.log(`Skipping invalid or empty message in collection: ${JSON.stringify(item)}`);
        }
    }
    return assembled_chat;
}

function splitArrayByChatHistory(arr) {
    if (!Array.isArray(arr)) {
        return [[], [], []];
    }

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < arr.length; i++) {
        if (!arr[i]) {
            continue;
        } else if (typeof arr[i].identifier === 'string' && arr[i].identifier.includes("chatHistory")) {
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

function filterUndefined(arr) {
    return arr.filter(element => element !== undefined);
}

function filterEmptyContentMessages(arr) {
    return arr.filter(element => element.content !== '');
}
  

function mergeMessagesByRole(messages, separator) {
    const mergedMessages = [];
    if (messages.length === 0) {
        return mergedMessages;
    }

    mergedMessages.push({ ...messages[0] });

    for (let i = 1; i < messages.length; i++) {
        if (messages[i].role === mergedMessages[mergedMessages.length - 1].role) {
            if (mergedMessages[mergedMessages.length - 1].content === '') {
                mergedMessages[mergedMessages.length - 1].content = messages[i].content;
            } else if (messages[i].content === '' && i !== messages.length - 1) {
                continue;
            } else {
                mergedMessages[mergedMessages.length - 1].content += separator + messages[i].content;
            }
        } else {
            mergedMessages.push({ ...messages[i] });
        }
    }

    return mergedMessages;
}

function filterChatHistoryByDepth(chatHistoryRaw, depthPromptsConfig) {
    if (!chatHistoryRaw || chatHistoryRaw.length === 0) {
        return [];
    }

    const depthRoleMap = depthPromptsConfig.reduce((map, dp) => {
        if (typeof dp.injection_depth === 'number' && dp.injection_depth > 0) {
            map[dp.injection_depth] = dp.role;
        }
        return map;
    }, {});

    const filteredHistory = [];
    let depthCounter = 0;

    for (let idx = chatHistoryRaw.length - 1; idx >= 0; idx--) {
        const message = chatHistoryRaw[idx];

        const expectedDepthRole = depthRoleMap[depthCounter];
        const expectedNextDepthRole = depthRoleMap[depthCounter + 1];

        if (idx === 0) {
            filteredHistory.push(message);
            return filteredHistory.reverse();
        } else if (message.role !== chatHistoryRaw[idx-1].role) {
            if (expectedNextDepthRole && expectedNextDepthRole === message.role) {
                continue;
            } else {
                filteredHistory.push(message);
            }
            depthCounter++;
        } else if (idx == chatHistoryRaw.length - 1 || message.role !== chatHistoryRaw[idx+1].role) {
            if (expectedDepthRole && expectedDepthRole === message.role) {
                continue;
            } if (expectedNextDepthRole && expectedNextDepthRole === message.role) {
                filteredHistory.push(message);
            } else {
                filteredHistory.push(message);
            }
        } else if (message.role === chatHistoryRaw[idx-1].role) {
            if (expectedDepthRole && expectedDepthRole === message.role) {
                continue;
            } if (expectedNextDepthRole && expectedNextDepthRole === message.role) {
                continue;
            } else {
                filteredHistory.push(message);
            }
        }
    }
}

function splitBySeparator(text, separator, isRegex, keepSeparator) {
    if (!separator || !text) return [text];

    const regex = isRegex ? stringToRegExp(separator) : new RegExp(separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!regex) return [text];

    const parts = text.split(regex);
    if (parts.length <= 1) return [text];

    if (keepSeparator) {
        const matches = text.match(new RegExp(regex.source, 'g' + (regex.flags || '')));
        if (matches) {
            for (let i = 0; i < parts.length - 1; i++) {
                if (parts[i+1] !== undefined) {
                    parts[i+1] = matches[i] + parts[i+1];
                }
            }
        }
    }

    return parts.filter(p => p);
}

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
    if (!extension_settings.NoAss.noass_is_enabled || !isChatCompletion() || this_chid === undefined) return;
    cachedStopString = undefined;
    clientStopStringTriggered = false;
    maxSymbolsReached = false;

    console.debug(`${defaultExtPrefix} Updating prompt`);

    const activeSet = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx];
    cachedMaxSymbols = parseInt(substituteParams(String(activeSet.max_symbols)));
    if (isNaN(cachedMaxSymbols)) cachedMaxSymbols = defaultSet.max_symbols;
    const { zero_prefill, enable_stop_string } = activeSet;
    const selection = activeSet.stop_string_selection ?? 0;
    const selectedStopString = activeSet.stop_strings[selection];
    const stop_string = selectedStopString.value;
    const separator = { newline: '\n', space: ' ' }[activeSet.messages_separator] || '\n\n';

    flushEphemeralStoppingStrings();
    if (stop_string && enable_stop_string && !selectedStopString.client) {
        addEphemeralStoppingString(substituteParams(stop_string));
        if (activeSet.enable_zero_prefill && zero_prefill && stop_string.startsWith(zero_prefill)) {
            addEphemeralStoppingString(substituteParams(stop_string.replace(zero_prefill, "")));
        }
    }

    const messages = filterUndefined([...promptManager.messages.collection]);
    const promptsCollection = promptManager.getPromptCollection().collection;
    const depthPrompts = promptsCollection.filter(prompt => prompt.name.includes(depthPromptPrefix) && prompt.injection_position === 1 && prompt.content);

    let processedDepthPrompts = [];
    if (depthPrompts.length > 0) {
        const groupedByDepth = depthPrompts.reduce((acc, prompt) => {
            const depth = prompt.injection_depth;
            acc[depth] = acc[depth] || [];
            acc[depth].push(prompt);
            return acc;
        }, {});

        const mergedPromptsArray = [];
        const depthKeys = Object.keys(groupedByDepth).map(Number).sort((a, b) => a - b);

        for (const depthKey of depthKeys) {
            const group = groupedByDepth[depthKey];
            if (group.length > 1) {
                const firstPromptInGroup = group[0];
                const combinedContent = group.map(p => p.content).join(separator);
                mergedPromptsArray.push({
                    ...firstPromptInGroup,
                    content: combinedContent,
                });
            } else {
                mergedPromptsArray.push(...group);
            }
        }
        processedDepthPrompts = mergedPromptsArray;
    } else {
        processedDepthPrompts = [];
    }
    
    const [beforeChatRaw, chatHistoryRaw, afterChatRaw] = splitArrayByChatHistory(messages);
    const filteredChatHistoryRaw = filterChatHistoryByDepth(chatHistoryRaw, depthPrompts);
    const chatHistory = mergeMessagesByRole(getChat(filteredChatHistoryRaw), separator);
    const baseOffset = unhiddenChat.length - chatHistory.length;

    function squashChatHistoryPart(chatHistoryPart, idxOffset) {
        const chatHistoryPartSquashed = chatHistoryPart.reduce((history, message, idx) => {
            let prefix;
            let suffix;
            const chatIndex = Math.max(0, baseOffset + idxOffset + idx);
            const timestampDict = { timestamp: getSendDate(chatIndex) };
            switch (message.role) {
                case MessageRole.USER:
                    prefix = substituteParams(activeSet.user_prefix, { dynamicMacros: timestampDict });
                    suffix = substituteParams(activeSet.user_suffix, { dynamicMacros: timestampDict });
                    break;
                case MessageRole.ASSISTANT:
                    prefix = substituteParams(activeSet.char_prefix, { dynamicMacros: timestampDict });
                    suffix = substituteParams(activeSet.char_suffix, { dynamicMacros: timestampDict });
                    break;
                default:
                    prefix = '';
                    suffix = '';
            }
            if (history === '') {
                return `${prefix}${message.content.trim()}${suffix}`;
            } else {
                return `${history}${separator}${prefix}${message.content.trim()}${suffix}`;
            }
        }, '');

        return {
            role: activeSet.squash_role,
            content: chatHistoryPartSquashed,
        };
    }

    let squashedChatHistoryParts = [];
    if (processedDepthPrompts.length === 0) {
        squashedChatHistoryParts.push(squashChatHistoryPart(chatHistory, 0));
    } else {
        processedDepthPrompts.sort((p1, p2) => p2.injection_depth - p1.injection_depth);
        let currentHistory = [...chatHistory];
        let currentOffset = 0;

        for (const depthPrompt of processedDepthPrompts) {
            const depth = depthPrompt.injection_depth;

            const insertionIndex = currentHistory.length - 1 - depth;

            if (insertionIndex < -1) {
                continue;
            }

            const before = currentHistory.slice(0, Math.max(0, insertionIndex + 1));
            const after = currentHistory.slice(Math.max(0, insertionIndex + 1));

            const depthPromptMessage = {
                role: depthPrompt.role,
                content: substituteParams(depthPrompt.content),
            };

            if (before.length > 0) {
              squashedChatHistoryParts.push(squashChatHistoryPart(before, currentOffset));
            }
            
            squashedChatHistoryParts.push(depthPromptMessage);

            currentHistory = after;
            currentOffset += before.length;
        }

        if (currentHistory.length > 0) {
            squashedChatHistoryParts.push(squashChatHistoryPart(currentHistory, currentOffset));
        }
    }

    const separatorSelection = activeSet.squashed_separator_selection ?? 0;
    const selectedSeparator = activeSet.squashed_separators[separatorSelection];

    if (selectedSeparator.enable) {
        const newSquashedParts = [];
        for (const part of squashedChatHistoryParts) {
            if (part && part.content) {
                const splitParts = splitBySeparator(
                    part.content,
                    selectedSeparator.string,
                    selectedSeparator.regex,
                    selectedSeparator.keep
                );
                for (let i = 0; i < splitParts.length; i++) {
                    newSquashedParts.push({ ...part, content: splitParts[i] });
                    if (selectedSeparator.prompt_enable && selectedSeparator.prompt_string && i < splitParts.length - 1) {
                        newSquashedParts.push({
                            role: selectedSeparator.prompt_role,
                            content: substituteParams(selectedSeparator.prompt_string),
                        });
                    }
                }
            } else {
                newSquashedParts.push(part);
            }
        }
        squashedChatHistoryParts = newSquashedParts;
    }

    const beforeChat = getChat(beforeChatRaw);
    const afterChat = getChat(afterChatRaw);

    if (activeSet.enable_zero_prefill && zero_prefill) {
        afterChat.push({
            role: MessageRole.ASSISTANT,
            content: substituteParams(zero_prefill)
        });
    }
    
    let finalChat = [];
    if (!activeSet.separate_chat_history) {
        const reassembledChat = mergeMessagesByRole([...beforeChat, ...squashedChatHistoryParts, ...afterChat], separator);
        finalChat = mergeMessagesByRole(filterEmptyContentMessages(reassembledChat), separator);
    } else {
        const cleanedBeforeChat = mergeMessagesByRole(filterEmptyContentMessages(beforeChat), separator);
        const cleanedChat = mergeMessagesByRole(filterEmptyContentMessages(squashedChatHistoryParts), separator);
        const cleanedAfterChat = mergeMessagesByRole(filterEmptyContentMessages(afterChat), separator);
        finalChat = [...cleanedBeforeChat, ...cleanedChat, ...cleanedAfterChat];
    }

    data.chat.length = 0;

    for (let idx = 0; idx < finalChat.length; idx++) {
        data.chat.push({ ...finalChat[idx] });
    }

    console.debug(`${defaultExtPrefix} Prompt updated`);
});

eventSource.makeFirst(event_types.STREAM_TOKEN_RECEIVED, (text) => {
    if (!extension_settings.NoAss.noass_is_enabled || !isChatCompletion()) return;
    isSteaming = true;
    if (!clientStopStringTriggered) clientStopStringHandler(text);
    const max_symbols = cachedMaxSymbols ?? defaultSet.max_symbols;
    if (!maxSymbolsReached) {
        maxSymbolsReached = text.length > max_symbols;
        if (maxSymbolsReached) stopGeneration();
    }
});

eventSource.makeFirst(event_types.MESSAGE_RECEIVED, async (messageId) => {
    if (!extension_settings.NoAss.noass_is_enabled || !isChatCompletion() || messageId === 0 || this_chid === undefined) return;
    const activeSet = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx];
    
    if (!isSteaming) clientStopStringHandler(chat[messageId].mes, false);
    if (clientStopStringTriggered) {
        const selection = activeSet.stop_string_selection ?? 0;
        const selectedStopString = activeSet.stop_strings[selection];
        if (selectedStopString.regex) {
            chat[messageId].mes = removeAfterRegexMatch(chat[messageId].mes, cachedStopString);
        } else {
            chat[messageId].mes = removeAfterSubstring(chat[messageId].mes, cachedStopString);
        }
        if (chat[messageId].swipes) {
            chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
        }
        cachedStopString = undefined;
        clientStopStringTriggered = false;
        updateMessageBlock(messageId, chat[messageId], { rerenderMessage: true });
        await saveChat();
    };

    const max_symbols = cachedMaxSymbols ?? defaultSet.max_symbols;
    const maxSymbolsWithBuffer = max_symbols + 100;
    if (!isSteaming && chat[messageId].mes.length > maxSymbolsWithBuffer) {
        maxSymbolsReached = true;
        chat[messageId].mes = chat[messageId].mes.slice(0, maxSymbolsWithBuffer);
    }

    if (maxSymbolsReached) {
        chat[messageId].mes = removeAfterLastNewline(chat[messageId].mes);
        maxSymbolsReached = false;
        updateMessageBlock(messageId, chat[messageId], { rerenderMessage: true });
        await saveChat();
    }

    if (activeSet.enable_zero_prefill && !['...', ''].includes(chat[messageId]?.mes)) {
        const zero_prefill = substituteParams(activeSet.zero_prefill);
        if (zero_prefill && !chat[messageId].mes.startsWith(zero_prefill)) {
            chat[messageId].mes = zero_prefill + chat[messageId].mes;
            if (chat[messageId].swipes) {
                chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
            }
            updateMessageBlock(messageId, chat[messageId], { rerenderMessage: true });
            await saveChat();
        }
    };
    isSteaming = false;
});

eventSource.makeFirst(event_types.CHAT_CHANGED, () => {
    if (!extension_settings.NoAss.noass_is_enabled || this_chid === undefined) return;
    unhiddenChat = chat.filter(message => message.is_system !== true) ?? [];
});

eventSource.on("/fatpresets/import/noass", async ({ setObject, returnCode }) => {
    const isOk = importSetFromObject(setObject);
    returnCode.code = isOk;
});

eventSource.on("/fatpresets/change/noass", async ({ presetName, reloadFlag }) => {
    if (!extension_settings.NoAss.noass_is_enabled) {
        extension_settings.NoAss.noass_is_enabled = true;
        $('#noass_is_enabled').prop('checked', extension_settings.NoAss.noass_is_enabled);
        saveSettingsDebounced();
    }
    if (extension_settings.NoAss.active_set === presetName) return;

    const index = extension_settings.NoAss.sets.findIndex(set => set.name === presetName);
    if (index !== -1) {
        await changeSet(index);
    }
});

eventSource.on("/fatpresets/disable/noass", async () => {
    extension_settings.NoAss.noass_is_enabled = false;
    $('#noass_is_enabled').prop('checked', extension_settings.NoAss.noass_is_enabled);
    flushEphemeralStoppingStrings();
    saveSettingsDebounced();
});

jQuery(async () => {
    $('#extensions_settings').append(await renderExtensionTemplateAsync(path, 'settings'));
    loadSettings();
    setupListeners();
    console.log(`${defaultExtPrefix} extension loaded`);
});
