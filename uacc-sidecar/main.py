import sys
import os
import time
import asyncio
from fastmcp import FastMCP
import pygetwindow as gw
import pyautogui

# Initialize FastMCP server
mcp = FastMCP("UACC-Sidecar")

@mcp.tool()
def capture_screen() -> str:
    """
    Captures the current screen and returns the absolute file path to the saved screenshot.
    Useful for seeing what is currently on the user's screen.
    """
    filename = f"screenshot_{int(time.time())}.png"
    filepath = os.path.abspath(filename)
    pyautogui.screenshot(filepath)
    return f"Screenshot saved to {filepath}"

@mcp.tool()
def get_active_window_title() -> str:
    """
    Returns the title of the currently active/focused window.
    Useful for knowing what application the user is currently using.
    """
    try:
        active = gw.getActiveWindow()
        if active:
            return active.title
        return "No active window found"
    except Exception as e:
        return f"Error: {e}"

@mcp.tool()
def list_background_apps() -> list[str]:
    """
    Lists the titles of all open background windows.
    Useful for finding out if Spotify, YouTube, or other apps are running.
    """
    try:
        windows = gw.getAllTitles()
        return [w for w in windows if w.strip()]
    except Exception as e:
        return [f"Error: {e}"]

@mcp.tool()
def uacc_click(x: int, y: int) -> str:
    """
    Universal AI Computer Control: Clicks at the specified (x, y) coordinates on the screen.
    """
    try:
        pyautogui.click(x=x, y=y)
        return f"Clicked at ({x}, {y})"
    except Exception as e:
        return f"Failed to click: {e}"

@mcp.tool()
def uacc_type(text: str) -> str:
    """
    Universal AI Computer Control: Types the specified text using the keyboard.
    """
    try:
        pyautogui.write(text, interval=0.05)
        return f"Typed text successfully."
    except Exception as e:
        return f"Failed to type: {e}"

if __name__ == "__main__":
    mcp.run()
