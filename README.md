# Ngedit Blocks

A CEP panel for After Effects, for playing a block stacking game during
work breaks without leaving AE. Built from scratch from the public rules
of modern block stacking games, without assets from other games.

Just for fun.

## Features

- Modern rules: SRS, 7-bag, hold, ghost piece, and T-spin
- Guideline scoring, Back-to-Back, combo, and Perfect Clear
- DAS and ARR adjustable in the panel, best score saved automatically
- Synth SFX with Lembut and Punchy themes, and BGM, with separate buttons, BGM default OFF
- Adaptive panel, comfortable to use small or floating

## Install (Windows)

ZXP path: download `NgeditBlocks-2.0.2.zxp` from this repo, then install
it with a ZXP Installer. Open After Effects, then Window > Extensions >
Ngedit Blocks.

Manual folder path:

1. Close After Effects.
2. Copy the `NgeditBlocks` folder to `C:\Users\<your-username>\AppData\Roaming\Adobe\CEP\extensions\`
3. This extension is unsigned, so enable PlayerDebugMode in PowerShell:

   ```powershell
   foreach ($v in 'CSXS.10','CSXS.11','CSXS.12') { New-Item -Path "HKCU:\Software\Adobe\$v" -Force | Out-Null; Set-ItemProperty -Path "HKCU:\Software\Adobe\$v" -Name PlayerDebugMode -Value 1 -Type String }
   ```

4. Open After Effects, then Window > Extensions > Ngedit Blocks.

## Controls

Click the panel area first so the keyboard goes to the game, not to the
After Effects timeline. Left/right arrows move, down arrow soft drops,
up arrow or X rotates clockwise, Z rotates counter-clockwise, Space hard
drops, C or Shift holds, P pauses, R restarts. The full control list is
also on the panel start screen, and can be called up again with the ?
button in the button row.

If the panel does not appear, check that the folder name is
`NgeditBlocks`, that PlayerDebugMode is set, then restart AE. If the keys
do not respond, click the panel area first.

Version: 2.0.2
