# monday-importer

Import companies and analyst notes from Excel into Monday.com. Monday's native import doesn't support comments — this does.

## Setup

1. `cp .env.example .env`
2. Add your Monday API token and board ID to `.env`
3. Place your Excel file as `import.xlsx` in this folder
4. `npm install`
5. `npm run import`

## Excel format

| Company Name     | Notes                           |
|------------------|---------------------------------|
| Haast Autonomous | Strong team, drone logistics... |
| Forevolta        | Battery tech, interesting IP... |

- Row 1 is treated as a header and skipped
- Column 1: company name (becomes the Monday item name)
- Column 2: analyst note (posted as a comment on the item)

## Environment variables

```
MONDAY_API_TOKEN=your_token_here
MONDAY_BOARD_ID=18146507025
```

Get your API token from Monday.com → Profile → Developers → My Access Tokens.

## What it does

For each row in the Excel file:
1. Creates a new item on the specified Monday board using the company name
2. Posts the analyst note as a comment (update) on that item
3. Logs the created item ID to `import-log.txt`

Before importing, shows a preview of the first 3 rows and asks for confirmation.

Failed rows are logged with a warning and skipped — the import never crashes on a single row.

## Files

| File           | Purpose                          |
|----------------|----------------------------------|
| `import.js`    | Main script / CLI entry point    |
| `monday.js`    | Monday.com GraphQL API client    |
| `excel.js`     | Excel reader                     |
| `.env`         | Your credentials (git-ignored)   |
| `import.xlsx`  | Your data file (git-ignored)     |
| `import-log.txt` | Created item IDs (git-ignored) |
