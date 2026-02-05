<p align="center">
  <img src="logo.png" alt="My DevOps Timesheet" width="200">
</p>

<h1 align="center">My DevOps Timesheet</h1>

<p align="center">
  A Chrome side panel extension for viewing and editing Azure DevOps work item effort hours — right from your browser.
</p>

---

## Screenshots

| Work Items (Dark Mode) | Expanded Details |
|---|---|
| ![Dark mode work items](screenshot-dark.png) | ![Expanded card details](screenshot-expanded.png) |

## Features

- **Side panel UI** — opens alongside your current tab, no context switching
- **Inline editing** — click Remaining or Completed hours to update directly, saves to Azure DevOps instantly
- **Expand details** — click the arrow on any card to see State, Type, Priority, Assigned To, Iteration, Area, and Description
- **Double-click to open** — double-click a card to open the work item in Azure DevOps
- **Filter by type & iteration** — quickly narrow down to Tasks, Bugs, Stories, etc.
- **Dark mode** — toggle between light and dark themes, preference is saved
- **Hover tooltips** — hover over any card for a quick summary of all fields
- **PAT authentication** — securely stored in Chrome sync storage

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `devops-timesheet` folder
5. Click the extension icon in the toolbar — the side panel opens

## Setup

1. Click the extension icon to open the side panel
2. Enter your Azure DevOps **Organization**, **Project**, and **Personal Access Token**
3. Click **Save & Connect**

### Creating a PAT

1. Go to `https://dev.azure.com/{your-org}/_usersettings/tokens`
2. Click **New Token**
3. Give it a name and set expiration
4. Under **Scopes**, grant **Work Items → Read & Write**
5. Copy the token and paste it into the extension settings

## Usage

- **Edit hours** — click any Remaining or Completed value, type a new number, press Enter
- **Expand details** — click the triangle arrow next to the ID to reveal full work item details
- **Open in DevOps** — double-click a card to open it in a new tab
- **Filter** — use the Type and Iteration dropdowns in the toolbar
- **Refresh** — click the refresh button in the header to reload work items
- **Dark mode** — click the moon/sun icon in the header
- **Settings** — click the gear icon to change org, project, or PAT

## Tech Stack

- **Manifest V3** Chrome Extension
- Plain HTML / CSS / JavaScript — no build tools
- Azure DevOps REST API (WIQL + Work Items)

## File Structure

```
manifest.json       Chrome extension manifest
background.js       Opens side panel on toolbar icon click
sidepanel.html      Side panel markup
sidepanel.css       Styles with light/dark mode
sidepanel.js        State machine, API calls, rendering, inline editing
icons/              Extension icons (16, 48, 128px)
```

## License

MIT
