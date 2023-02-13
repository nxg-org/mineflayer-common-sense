import { createBot } from "mineflayer";
import commonSense from "../src/index"

const bot = createBot({
    username: "common-sense",
    host: process.argv[2] ?? "localhost",
    port: Number(process.argv[3]) ?? 25565,
});

bot.loadPlugin(commonSense)
bot.once("spawn", () => {
    bot.commonSense.setOptions({
        autoRespond: true,
        fallCheck: true,
        fireCheck: true,
        useOffhand: true
    })
})

