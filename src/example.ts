import { createBot } from "mineflayer";
import commonSense from "./index"
import { Vec3 } from "vec3";

const bot = createBot({
    username: "common-sense",
    host: process.argv[2] ?? "localhost",
    port: Number(process.argv[3]) ?? 25565,
});

bot.loadPlugin(commonSense)
bot.once("spawn", () => {
    bot.commonSense.autoRespond = true
    bot.commonSense.useOffHand = false
})

