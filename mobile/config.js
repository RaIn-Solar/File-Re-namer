// Fixed settings for the live Drive. The client ID is not a secret.
window.APP_CONFIG = {
  googleClientId: '836989093814-uofoivv6ruvc7didb2is6i6o7t6ddsnc.apps.googleusercontent.com',
  // The Contacts-Active folder. Uploads are only ever allowed two levels below it.
  driveRootFolderId: '1n51yFyfEpXPMpFoCh32o8xdNsx4qzCcC',
  // TESTING LOCK: only these customer folders are shown or writable. Clear the list
  // (allowedCustomers: []) only when Rachel says the app is live for everyone.
  allowedCustomers: ['Inman, Rachel'],
};
