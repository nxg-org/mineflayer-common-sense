import { createBot } from "mineflayer";
import commonSense from "./index"

const bot = createBot({
    username: "common-sense",
    host: process.argv[2] ?? "localhost",
    port: Number(process.argv[3]) ?? 25565,
    version: process.argv[4] ?? "1.17.1"
});

bot.loadPlugin(commonSense)
bot.once("spawn", () => {
    bot.commonSense.autoRespond = true
    bot.commonSense.useOffHand = true
})

