import browser from "webextension-polyfill"

export const MESSAGE_KEYS = [
  "extName",
  "extDescription",
  "popupTitle",
  "optionsTitle",
  "anonymousNickname",
  "clickToCopy",
  "copied",
  "videoNotDetectedYet",
  "videoDetected",
  "videoNotFound",
  "multipleVideosDetected",
  "injectedScriptNotReadyRetrySync",
  "roomCode",
  "connectedAndSyncing",
  "retrySync",
  "leaveRoom",
  "chatNickname",
  "nicknameOptional",
  "createRoom",
  "orJoin",
  "enterRoomCode",
  "roomCodeEmpty",
  "roomCodeTooLong",
  "roomCodeTooShort",
  "roomCodeFormatIncorrect",
  "joinRoom",
  "thanksForReporting",
  "reportWebsiteNotWorking",
  "reportWhatWentWrongOptional",
  "cancel",
  "sendReport",
  "reportIssue",
  "settings",
  "website",
  "settingsSaved",
  "failedToSaveSettings",
  "syncAudio",
  "syncAudioDescription",
  "chat",
  "chatDescription",
  "reactions",
  "reactionsDescription",
  "customPlayer",
  "customPlayerDescription",
  "saveSettings",
  "chooseVideoToSync",
  "unknownDuration",
  "switchToNativeVideoControls",
  "nativeUi",
  "switchToSynclifyVideoPlayer",
  "synclifyUi",
  "typeMessage"
] as const

export type MessageKey = (typeof MESSAGE_KEYS)[number]

export function t(key: MessageKey, substitutions?: string | string[]): string {
  return browser.i18n.getMessage(key, substitutions) || key
}

export function setDocumentTitle(key: MessageKey): void {
  document.title = t(key)
}
