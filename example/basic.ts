import { createBot } from "mineflayer";
import commonSense from "../src/index"

const bot = createBot({
    username: "common-sense",
    host: process.argv[2] ?? "localhost",
    port: Number(process.argv[3]) ?? 25565,
    hideErrors: false,
});

bot.loadPlugin(commonSense)
bot.once("spawn", () => {
    bot.commonSense.setOptions({
        autoRespond: true,
        mlgCheck: true,
        fireCheck: true,
        useOffhand: false
    })


    bot.on("chat", async (user, message) => {

        const [cmd, ...args] = message.trim().split(' ');

        switch (cmd) {


            case "pickup":
                const waterBlock = await bot.commonSense.findLocalWater(undefined, 5);
                if (waterBlock) {
                  console.log("picking up water", waterBlock.position);
                  bot.util.move.forceLookAt(waterBlock.position.offset(0.5, 0.5, 0.5), true);
                  if (bot.util.inv.getHandWithItem(bot.commonSense.options.useOffhand)?.name === "bucket") bot.activateItem(bot.commonSense.options.useOffhand);
                }
                break;
            case "toggle":
                bot.commonSense.options.autoRespond = !bot.commonSense.options.autoRespond
                bot.chat(`Set autoRespond to ${bot.commonSense.options.autoRespond}`)
                break
        }

    })
})

