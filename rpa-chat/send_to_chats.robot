*** Settings ***
Library    RPA.Windows    WITH NAME    Win
Library    RPA.Desktop    WITH NAME    Desk
Library    OperatingSystem

*** Variables ***
${CODEX_EXE}              Code.exe
${ANTI_EXE}               Antigravity.exe

# Hotkeys that put the caret in the chat input (recommended).
# Update these to match your keybindings.
@{CODEX_FOCUS_KEYS}       ctrl    alt    1
@{ANTI_FOCUS_KEYS}        ctrl    alt    2

# Optional: image paths to click the input box (fallback when focus is flaky).
# Leave empty to disable.
${CODEX_INPUT_IMAGE}      ${EMPTY}
${ANTI_INPUT_IMAGE}       ${EMPTY}

*** Tasks ***
Send clipboard prompt to Codex and Antigravity
    ${prompt}=    Desk.Get Clipboard Value
    Should Not Be Empty    ${prompt}
    Send Prompt To App    ${CODEX_EXE}    ${CODEX_INPUT_IMAGE}    @{CODEX_FOCUS_KEYS}    ${prompt}
    Send Prompt To App    ${ANTI_EXE}     ${ANTI_INPUT_IMAGE}     @{ANTI_FOCUS_KEYS}     ${prompt}

*** Keywords ***
Send Prompt To App
    [Arguments]    ${exe}    ${input_image}    @{focus_keys}    ${text}
    Win.Control Window    executable:${exe}
    Sleep    0.2

    ${has_image}=    Run Keyword And Return Status    File Should Exist    ${input_image}
    IF    ${has_image}
        Desk.Click    image:${input_image}
    ELSE
        Desk.Press Keys    @{focus_keys}
    END

    Sleep    0.2
    Desk.Set Clipboard Value    ${text}
    Desk.Press Keys    ctrl    v
    Desk.Press Keys    enter
    Sleep    0.2
