# CDP (Chrome DevTools Protocol) for MCP Development

AionUi supports CDP for external debugging tools integration. In development mode (`just dev`), CDP is enabled by default on port 9230.

## Enable CDP in Production

1. Open AionUi Settings ÔåÆ System ÔåÆ Developer Debug
2. Enable "Enable Remote Debugging (CDP)"
3. Restart the app

## Configure MCP chrome-devtools

Add this to your IDE's MCP configuration. The configuration file location depends on your IDE:

| IDE                | Config Path                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Cursor**         | `~/.cursor/mcp.json`                                                                                                                 |
| **VS Code**        | `~/.vscode/mcp.json`                                                                                                                 |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| **Codebuddy**      | `~/.codebuddy/mcp.json`                                                                                                              |

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@0.16.0", "--browser-url=http://127.0.0.1:9230"]
    }
  }
}
```

## Other AI-Friendly Development Tools

AionUi can integrate with other MCP tools for enhanced development experience:

| Tool               | Purpose                                             | Config                                    |
| ------------------ | --------------------------------------------------- | ----------------------------------------- |
| **Playwright MCP** | Browser automation (alternative to chrome-devtools) | `"@playwright/mcp@latest"`                |
| **Puppeteer MCP**  | Browser automation                                  | `"@puppeteer/mcp@latest"`                 |
| **Filesystem MCP** | File operations                                     | `@modelcontextprotocol/server-filesystem` |
| **Git MCP**        | Git repository operations                           | `@modelcontextprotocol/server-git`        |

See [MCP Servers](https://github.com/modelcontextprotocol/servers) for more tools.

## Usage with MCP

Once configured, you can use MCP tools to interact with AionUi:

- `list_pages` ÔÇö List all open pages in AionUi
- `take_snapshot` ÔÇö Get accessibility tree snapshot of current page
- `click`, `fill`, `hover` ÔÇö Interact with UI elements
- `navigate_page` ÔÇö Navigate to URLs

## Inspect with Chrome DevTools

1. Open `http://127.0.0.1:9230/json` in Chrome
2. Click on a page to inspect it with DevTools
3. Or use Chrome's `chrome://inspect` ÔåÆ Configure ÔåÆ add `127.0.0.1:9230`

---

# CDP (Chrome DevTools Protocol) MCP Õ╝ÇÕÅæ

AionUi µö»µîü CDP ö¿õ║ÄÕñûÚâ¿×░â×»òÕÀÑÕàÀÚøåµêÉÒÇéÕ£¿Õ╝ÇÕÅæµ¿íÕ╝Å (`just dev`) õ©ï´╝îCDP Ú╗İ×«ñÕ£¿½»ÕÅú 9230 ÕÉ»ö¿ÒÇé

## Õ£¿öşõ║ğÄ»ÕóâÕÉ»ö¿ CDP

1. µëôÕ╝Ç AionUi ×«¥¢« ÔåÆ │╗╗ş ÔåÆ Õ╝ÇÕÅæ×Çà×░â×»ò
2. ÕÉ»ö¿"ÕÉ»ö¿×┐£¿ï×░â×»ò (CDP)"
3. ÚçıÕÉ»Õ║öö¿

## Úàı¢« MCP chrome-devtools

Õ░åõ╗Ñõ©ïÚàı¢«µÀ╗ÕèáÕê░õ¢áÜä IDE Üä MCP Úàı¢«µûçõ╗Âõ©¡ÒÇéÚàı¢«µûçõ╗Âõ¢ı¢«ÕÅûÕå│õ║Äõ¢áõ¢┐ö¿Üä IDE´╝Ü

| IDE                | Úàı¢«×À»Õ¥ä                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**         | `~/.cursor/mcp.json`                                                                                                                  |
| **VS Code**        | `~/.vscode/mcp.json`                                                                                                                  |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) µêû `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| **Codebuddy**      | `~/.codebuddy/mcp.json`                                                                                                               |

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@0.16.0", "--browser-url=http://127.0.0.1:9230"]
    }
  }
}
```

## ÕàÂõ╗û AI ÕÅïÕÑ¢ÜäÕ╝ÇÕÅæÕÀÑÕàÀ

AionUi ÕÅ»õ╗ÑÚøåµêÉÕàÂõ╗û MCP ÕÀÑÕàÀµØÑÕóŞÕ╝║Õ╝ÇÕÅæõ¢ôÚ¬î´╝Ü

| ÕÀÑÕàÀ             | ö¿ÚÇö                                               | Úàı¢«                                    |
| ------------------ | ---------------------------------------------------- | ----------------------------------------- |
| **Playwright MCP** | µÁÅ×ğêÕÖ¿×ç¬Õè¿Õîû´╝êchrome-devtools µø┐õ╗úµû╣µíê´╝ë | `"@playwright/mcp@latest"`                |
| **Puppeteer MCP**  | µÁÅ×ğêÕÖ¿×ç¬Õè¿Õîû                                   | `"@puppeteer/mcp@latest"`                 |
| **Filesystem MCP** | µûçõ╗Âµôıõ¢£                                         | `@modelcontextprotocol/server-filesystem` |
| **Git MCP**        | Git õ╗ôÕ║ôµôıõ¢£                                     | `@modelcontextprotocol/server-git`        |

µø┤ÕñÜÕÀÑÕàÀ×»ÀµşÑ£ï [MCP Servers](https://github.com/modelcontextprotocol/servers)ÒÇé

## MCP õ¢┐ö¿µû╣Õ╝Å

Úàı¢«Õ«îµêÉÕÉÄ´╝îÕÅ»õ╗Ñõ¢┐ö¿ MCP ÕÀÑÕàÀõ©Ä AionUi õ║ñõ║Æ´╝Ü

- `list_pages` ÔÇö ÕêùÕç║ AionUi õ©¡µëÇµ£ëµëôÕ╝ÇÜäÚíÁÚØó
- `take_snapshot` ÔÇö ×ÄÀÕÅûÕ¢ôÕëıÚíÁÚØóÜäÕÅ»×«┐Úù«µÇğµáæÕ┐½àğ
- `click`, `fill`, `hover` ÔÇö õ©Ä UI Õàâ┤áõ║ñõ║Æ
- `navigate_page` ÔÇö Õ»╝×ê¬Õê░ URL

## õ¢┐ö¿ Chrome DevTools µúÇµşÑ

1. Õ£¿ Chrome õ©¡µëôÕ╝Ç `http://127.0.0.1:9230/json`
2. é╣Õç╗ÚíÁÚØóÚô¥µÄÑõ¢┐ö¿ DevTools µúÇµşÑ
3. µêûõ¢┐ö¿ Chrome Üä `chrome://inspect` ÔåÆ Úàı¢« ÔåÆ µÀ╗Õèá `127.0.0.1:9230`
