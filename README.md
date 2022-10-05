# Mineflayer Common Sense


```ts
import { createBot } from "mineflayer";
import commonSense from "@nxg-org/mineflayer-common-sense"

const bot = createBot( { ... });

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
