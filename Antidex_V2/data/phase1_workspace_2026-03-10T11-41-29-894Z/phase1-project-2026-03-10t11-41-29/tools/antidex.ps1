param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
node "$PSScriptRoot\antidex.js" @Args
