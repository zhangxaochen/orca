/**
 * The focus-isolation scenarios in a visible window that owns OS focus (#20595). Hidden runs
 * cannot show a native focus move, so this asserts which webContents Electron reports focused.
 * Visible-window spec: run it on an isolated display (CI's Xvfb lane), never on a desktop in use.
 */

import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  runAgentClicksScenario,
  runAgentKeysScenario,
  runAgentShortcutsScenario
} from './helpers/browser-agent-focus-scenarios'

async function expectOrcaWindowOwnsNativeFocus(electronApp: ElectronApplication): Promise<void> {
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow, webContents }) => ({
        windowFocused: BrowserWindow.getFocusedWindow() !== null,
        focusedType: webContents.getFocusedWebContents()?.getType() ?? null
      }))
    )
    .toEqual({ windowFocused: true, focusedType: 'window' })
}

const scenarios = [
  ['agent keys and text', runAgentKeysScenario],
  ['agent clicks and presses', runAgentClicksScenario],
  ['agent shortcut keys', runAgentShortcutsScenario]
] as const

for (const [name, run] of scenarios) {
  test(`${name} leave native focus with the user’s terminal @headful`, async ({
    orcaPage,
    electronApp
  }) => {
    test.setTimeout(120_000)
    await orcaPage.bringToFront()
    await expectOrcaWindowOwnsNativeFocus(electronApp)
    await run(orcaPage)
    await expectOrcaWindowOwnsNativeFocus(electronApp)
  })
}
