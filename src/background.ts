export {}

console.log("loaded")

// stores tab id in a cookie so it can be accessed SYNCHRONOUSLY from content script
// if users opens two tabs on the same website, the same cookie is used which leads to the same room code used
// TODO: find a better solution
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    changeInfo.url &&
    changeInfo.url != "chrome://newtab/" &&
    changeInfo.url != "chrome://extensions/"
  ) {
    console.log(tabId)
    chrome.cookies.set({
      name: "tab_id",
      value: tabId.toString(),
      url: changeInfo.url
    })
  }
})
