// Facebook Monitor Webhook - Fixed Version
const SHEET_NAME = 'Facebook Alerts';
function doPost(e) {
try {
// Parse the incoming data from our Chrome extension
const data = JSON.parse(e.postData.contents);
return handleWebhook(data);
} catch (error) {
console.error('Error processing webhook:', error);
return createResponse(400, { error: error.toString() });
}
}
function doGet(e) {
return createResponse(200, {
status: 'active',
message: 'Facebook monitor webhook is running',
instructions: 'Send POST requests with match data to this URL',
sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
});
}
function handleWebhook(data) {
const sheet = getOrCreateSheet();
const matches = data.matches || [];
console.log(`Processing ${matches.length} matches from Facebook monitor`);
// Add each match as a row in the sheet
matches.forEach(match => {
const row = [
new Date(), // Timestamp when recorded
match.keyword,
match.group,
match.preview,
match.timestamp, // Original post timestamp
match.fullText || 'N/A',
data.source || 'chrome_extension' // Track where it came from
];
sheet.appendRow(row);
});
// Format the new rows if any were added
if (matches.length > 0) {
const lastRow = sheet.getLastRow();
const firstNewRow = lastRow - matches.length + 1;
// Auto-resize columns to fit content
sheet.autoResizeColumns(1, 7);
// Add borders to new rows
const newRange = sheet.getRange(firstNewRow, 1, matches.length, 7);
newRange.setBorder(true, true, true, true, true, true);
// Send email notifications if matches found
if (matches.length > 0) {
sendNotifications(matches);
}
}
return createResponse(200, {
success: true,
message: `Processed ${matches.length} matches`,
recorded: matches.length,
sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
});
}
function getOrCreateSheet() {
const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
let sheet = spreadsheet.getSheetByName(SHEET_NAME);
if (!sheet) {
// Create new sheet with headers
sheet = spreadsheet.insertSheet(SHEET_NAME);
// Create headers
const headers = [
'Recorded At',
'Keyword',
'Group',
'Preview',
'Post Time',
'Full Text',
'Source'
];
sheet.getRange('A1:G1').setValues([headers]);
sheet.getRange('A1:G1').setFontWeight('bold');
sheet.setFrozenRows(1); // Keep headers visible when scrolling
// Set column widths
sheet.setColumnWidth(1, 150); // Recorded At
sheet.setColumnWidth(2, 120); // Keyword
sheet.setColumnWidth(3, 120); // Group
sheet.setColumnWidth(4, 300); // Preview
sheet.setColumnWidth(5, 150); // Post Time
sheet.setColumnWidth(6, 400); // Full Text
sheet.setColumnWidth(7, 100); // Source
console.log('Created new sheet with headers');
}
return sheet;
}
function sendNotifications(matches) {
const plainTextBody = createEmailBody(matches);
const htmlBody = createHtmlEmailBody(matches);
const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
try {
// Send HTML email with clickable links
GmailApp.sendEmail(
Session.getEﬀectiveUser().getEmail(),
`Buﬃni Facebook Alert: ${matches.length} New Keyword Matches Found!`,
plainTextBody,
{
htmlBody: htmlBody
}
);
console.log(`✅ Email notification sent for ${matches.length} matches`);
} catch (error) {
console.error('Failed to send email notification:', error);
}
}
function createHtmlEmailBody(matches) {
let html = `
<div style="font-family: Arial, sans-serif; max-width: 600px;">
<h2 style="color: #1877F2; border-bottom: 2px solid #1877F2; padding-bottom:
10px;">Buﬃni Facebook Alert</h2>
<p>Found <strong style="color: #1877F2;">${matches.length}</strong> new posts
matching your monitored keywords!</p>
<hr style="border: 1px solid #e0e0e0;">
`;
matches.forEach((match, index) => {
const groupUrl = `https://facebook.com/groups/${match.group}`;
html += `
<div style="margin: 20px 0; padding: 15px; border-left: 4px solid #1877F2; background:
#f8f9fa; border-radius: 4px;">
<h3 style="margin-top: 0; color: #333;">Match ${index + 1}: "${match.keyword}"</h3>
<p style="margin: 8px 0;"><strong>Group:</strong> <a href="${groupUrl}" style="color:
#1877F2; text-decoration: none; font-weight: bold;" target="_blank">${match.group} →</a></
p>
<p style="margin: 8px 0;"><strong>Preview:</strong> ${match.preview}</p>
<p style="margin: 8px 0; color: #666; font-size: 14px;"><strong>Detected:</strong> $
{new Date().toLocaleString()}</p>
</div>
`;
});
const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
html += `
<div style="margin-top: 30px; padding: 15px; background: #e7f3ﬀ; border-radius: 6px;">
<p style="margin: 0 0 10px 0;"><strong>View all matches in Google Sheets:</strong></
p>
<p style="margin: 0;"><a href="${sheetUrl}" style="color: #1877F2; text-decoration: none;
font-weight: bold;" target="_blank">📊 Open Google Sheet →</a></p>
</div>
<div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
<p style="margin: 5px 0; font-size: 14px; color: #666;"><strong>Keywords monitored:</
strong> ${matches.map(m => m.keyword).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</p>
<p style="margin: 5px 0; font-size: 14px; color: #666;"><strong>Groups scanned:</
strong> ${matches.map(m => m.group).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</p>
</div>
<div style="margin-top: 15px; font-size: 12px; color: #999;">
<p>This alert was generated automatically by your Buﬃni Facebook Monitor.</p>
</div>
</div>
`;
return html;
}
function createEmailBody(matches) {
let body = `Buﬃni FACEBOOK KEYWORD ALERT\n`;
body += `========================\n\n`;
body += `Found ${matches.length} new posts matching your monitored keywords!\n\n`;
matches.forEach((match, index) => {
const groupUrl = `https://facebook.com/groups/${match.group}`;
body += `MATCH ${index + 1}:\n`;
body += ` Keyword: ${match.keyword}\n`;
body += ` Group: ${match.group}\n`;
body += ` Group Link: ${groupUrl}\n`;
body += ` Preview: ${match.preview}\n`;
body += ` Detected: ${new Date().toLocaleString()}\n`;
body += ' ---------------------------------------\n\n';
});
const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
body += `VIEW ALL MATCHES:\n`;
body += `${sheetUrl}\n\n`;
body += `This alert was generated automatically by your Buﬃni Facebook Monitor.`;
return body;
}
function createResponse(code, data) {
return ContentService
.createTextOutput(JSON.stringify(data))
.setMimeType(ContentService.MimeType.JSON);
}
// TEST FUNCTION - Run this to verify everything works
function testWebhook() {
console.log('🧪 Testing webhook functionality...');
const testData = {
matches: [{
keyword: "wilmington",
group: "test-group-123",
preview: "This is a test notification for wilmington area housing",
timestamp: new Date().toISOString(),
fullText: "Full test text mentioning wilmington and surrounding areas for housing
opportunities"
}],
timestamp: new Date().toISOString(),
source: 'test'
};
const result = handleWebhook(testData);
console.log('Test completed:', result);
return result;
}