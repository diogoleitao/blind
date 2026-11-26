# Hidden Tabs

Hide a Tab to take it out of the Tab bar without closing it. Nothing ends: its Shells keep running, and you can still find it in the [Command Palette](command-palette.md).

## Hiding a Tab

`Cmd+H`, or the Hide Tab action, hides the Current Tab. The Tab to its right takes its place, or the Tab to its left when it was the rightmost. The Session's last shown Tab can't be hidden.

A Hidden Tab is left out of `Cmd+1` to `Cmd+9` and Next and Previous Tab. It shows in italic in the [Command Palette](command-palette.md) and the [Activity Sidebar](activity.md#activity-sidebar), its Panes too.

While Hidden Tabs have [Activity](activity.md), the Tab bar counts them after the shown Tabs, such as `+2`.

Hidden Tabs stay hidden through [Restore](restore.md).

## Bringing a Tab back

Choose a Hidden Tab, or one of its Panes, in the Command Palette or the Activity Sidebar. It comes back as the rightmost Tab.

## Settings

- [`hiddenTab.returnPosition`](../configuration/settings.md#hiddentabreturnposition): where a Hidden Tab goes when it comes back.
