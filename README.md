# Facebook Keyword Alert System - Complete Setup Guide
## 📋 Overview
This system monitors Facebook groups for specific keywords and automatically logs matches
to a Google Sheet with email notifications. It consists of a Chrome extension and a Google
Apps Script webhook.
---
## 🚀 Part 1: Chrome Extension Setup
### **Step 1: Prepare the Extension Files**
1. You will receive a folder called `facebook-keyword-alert` containing these files:
- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`
- `popup.js`
- `icons/` (folder with icon images)
2. Save this folder to a permanent location on your computer (like Documents or Desktop)
### **Step 2: Install the Extension in Chrome**
1. Open **Google Chrome**
2. Navigate to the extensions page by:
- Typing `chrome://extensions` in the address bar, OR
- Clicking **⋮ (Menu) → More tools → Extensions**
3. **Enable Developer Mode:**
- Toggle the **"Developer mode"** switch in the top-right corner to **ON**
- You should see new buttons appear
4. **Load the Extension:**
- Click the **"Load unpacked"** button
- Navigate to and select the `facebook-keyword-alert` folder
- Click **Select Folder**
5. **Verify Installation:**
- The extension should appear in your extensions list
- You should see the Facebook Keyword Alert icon in Chrome's toolbar
![Extensions page showing Developer Mode enabled and Load unpacked button](https://
example.com/extensions-page.png)
---
## 📊 Part 2: Google Sheets & Apps Script Setup
### **Step 3: Create the Google Sheet**
1. Go to [sheets.google.com](https://sheets.google.com)
2. Click **"+ Blank"** to create a new spreadsheet
3. Name it **"Facebook Keyword Alerts"**
4. Keep this tab open - you'll need the URL later
### **Step 4: Create the Apps Script Webhook**
1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete any default code in the script editor
3. Copy and paste the **complete script** from script.js into the script editor.

### **Step 5: Save and Deploy the Script**
1. **Save the Project:**
- Press `Ctrl+S` (or `Cmd+S` on Mac)
- Name the project: **"Facebook Monitor Webhook"**
2. **Deploy as Web App:**
- Click **Deploy → New deployment**
- Click the gear icon ⚙ and select **"Web app"**
- Configure the deployment:
- **Description:** `Facebook Keyword Monitor`
- **Execute as:** `Me`
- **Who has access:** `Anyone`
- Click **Deploy**
3. **Copy the Web App URL:**
- You'll see a URL that looks like: `https://script.google.com/macros/s/ABC123/exec`
- **COPY THIS URL** - you'll need it for the extension configuration
### **Step 6: Authorize Permissions**
1. Click **"Review Permissions"**
2. Choose your Google account
3. You may see a security warning - click **"Advanced"**
4. Click **"Go to Facebook Monitor Webhook (unsafe)"**
5. Click **"Allow"** to grant all necessary permissions
### **Step 7: Test the Setup**
1. Go back to the Apps Script editor
2. Select `testWebhook` from the function dropdown
3. Click **Run ▶**
4. Check that:
- ✅ Your Google Sheet now has a test row
- ✅ You received a test email notification
---
## 🔗 Part 3: Connect Extension to Webhook
### **Step 8: Configure Extension Settings**
1. Click the **Facebook Keyword Alert extension icon** in Chrome's toolbar
2. Click **"Settings"** or **"Configure"**
3. Paste your **Web App URL** in the "Webhook URL" field
4. Configure your keywords (comma-separated):
- Example: `real estate, mortgage, housing market`
5. Set scan interval (recommended: 2-5 minutes)
6. Click **"Save Settings"**
### **Step 9: Test the Complete System**
1. Navigate to a Facebook group you want to monitor
2. The extension will automatically start scanning
3. When it finds keyword matches, it will:
- ✅ Add them to your Google Sheet
- ✅ Send email notifications
- ✅ Show desktop notifications
---
## 🛠 Troubleshooting
### **Common Issues & Solutions:**
**Extension not loading:**
- Verify all files are in the `facebook-keyword-alert` folder
- Check that `manifest.json` is valid JSON
- Ensure Developer Mode is enabled
**Webhook errors:**
- Verify the Web App URL is correct
- Check that the script is deployed with "Anyone" access
- Run the `testWebhook` function to verify setup
**No email notifications:**
- Check spam folder
- Verify GmailApp permissions were granted
- Run test function to confirm email setup
**Duplicate entries:**
- The system automatically filters duplicates from the last 100 entries
- Each match is unique by keyword + post content
---
## 📖 Usage Tips
- **Monitor multiple groups:** The extension works on any Facebook groups you visit
- **Keyword strategy:** Use specific phrases to reduce false positives
- **Review regularly:** Check your Google Sheet for new matches
- **Adjust settings:** Modify scan frequency based on your needs
- **Backup configuration:** Save your webhook URL and keywords somewhere safe
---
## 🔒 Privacy & Security
- All data is stored in your own Google Sheet
- The extension only accesses Facebook groups you actively visit
- No data is sent to third-party servers except your Google Apps Script webhook
- You can revoke permissions anytime via Google Account settings
---
## 🆘 Support
If you encounter issues:
1. Check the browser console for error messages (F12 → Console)
2. Verify all setup steps were completed
3. Test the webhook independently using the test function
4. Ensure all permissions are granted
Your Facebook Keyword Alert system is now ready to monitor groups and notify you of relevant
posts! 🎉
