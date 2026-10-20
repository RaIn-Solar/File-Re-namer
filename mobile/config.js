// Fixed settings for the live Drive. The client ID is not a secret.
window.APP_CONFIG = {
  googleClientId: '836989093814-uofoivv6ruvc7didb2is6i6o7t6ddsnc.apps.googleusercontent.com',
  // The Contacts-Active folder. Uploads are only ever allowed two levels below it.
  driveRootFolderId: '1n51yFyfEpXPMpFoCh32o8xdNsx4qzCcC',
  // Testing lock, lifted 2026-10-20 at Rachel's request. To limit the app again, list the exact customer
  // folder names here, e.g. ['Inman, Rachel']. An empty list means any customer folder can be searched.
  allowedCustomers: [],
};
