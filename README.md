# Mineflayer Common Sense


### Basic Usage
```ts
import { createBot } from "mineflayer";
import commonSense from "@nxg-org/mineflayer-common-sense"

const bot = createBot({ ... });

bot.loadPlugin(commonSense)

bot.once("spawn", () => {
    bot.commonSense.setOptions({

        // automatically respond to events.
        autoRespond: true,

        // check if we're currently falling (does not mean it will respond)
        fallCheck: true,

        // check if we're currently on fire (does not mean it will respond)
        fireCheck: true,

        // all responses will use the off-hand for placements (boolean)
        useOffhand: true
    })
})

```

This module is meant to provide basic responses to events that inconvenience the bot and are trivial to implement.



Because I hate writing README's for whatever reason, the publicly accessible methods are the public functions in ``example/basic.ts``. The names are self explanatory.