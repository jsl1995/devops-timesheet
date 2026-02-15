# Privacy Policy for My DevOps Timesheet

**Last Updated:** February 15, 2026

## Overview

My DevOps Timesheet is a Chrome browser extension that allows users to view and edit Azure DevOps work item effort fields from a side panel. This privacy policy explains what information the extension collects, how it is used, and how it is protected.

## Information We Collect

### Authentication Information
- **Azure DevOps Personal Access Token (PAT):** Required to authenticate with the Azure DevOps REST API on your behalf.
- **Organization Name:** The name of your Azure DevOps organization.
- **Project Name:** The name of your Azure DevOps project.

### User Preferences
- Theme preference (light/dark mode)
- Filter settings (work item type, iteration)

## How Information Is Stored

All data is stored locally in your browser using Chrome's built-in `chrome.storage.sync` API. This means:

- Data is stored on your device and synced across your Chrome browsers if you are signed into Chrome
- Data is encrypted by Chrome's storage system
- **No data is transmitted to or stored on any external servers operated by us**
- Data remains under your control and can be deleted at any time by removing the extension

## How Information Is Used

Your information is used solely to:

1. Authenticate API requests to Azure DevOps (dev.azure.com)
2. Fetch work items assigned to you from your Azure DevOps project
3. Update work item effort fields (Remaining Work, Completed Work) when you make edits
4. Remember your display preferences between sessions

## Information We Do NOT Collect

- Personal identifiable information (name, email, address)
- Health information
- Financial or payment information
- Location data
- Browsing history
- User activity or behavior analytics
- Website content from other sites

## Third-Party Services

The extension communicates only with:

- **Azure DevOps (dev.azure.com):** To fetch and update work items using the Azure DevOps REST API

We do not share, sell, or transmit your data to any other third parties.

## Data Security

- Your PAT is stored using Chrome's secure storage API
- All communication with Azure DevOps uses HTTPS encryption
- The extension does not use remote code or external scripts
- No analytics or tracking services are integrated

## Your Rights

You can:

- **View your stored data:** Access Chrome's extension storage via developer tools
- **Delete your data:** Remove the extension to delete all stored data, or clear settings through the extension's interface
- **Revoke access:** Delete or regenerate your Azure DevOps PAT at any time through Azure DevOps settings

## Children's Privacy

This extension is intended for professional use and is not directed at children under 13. We do not knowingly collect information from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date above. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

If you have questions about this privacy policy or the extension's data practices, please contact:

**Email:** [your-email@example.com]

**GitHub:** [https://github.com/jsl1995/devops-timesheet](https://github.com/jsl1995/devops-timesheet)

---

This extension is open source. You can review the source code to verify our data practices.
