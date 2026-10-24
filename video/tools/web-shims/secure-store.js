// expo-secure-store for the companion's web build, which only exists to record the phone scenes.
// Browsers have no keychain, so this keeps the values in localStorage.
export async function getItemAsync(key) {
  return window.localStorage.getItem(key);
}
export async function setItemAsync(key, value) {
  window.localStorage.setItem(key, value);
}
export async function deleteItemAsync(key) {
  window.localStorage.removeItem(key);
}
export async function isAvailableAsync() {
  return true;
}
