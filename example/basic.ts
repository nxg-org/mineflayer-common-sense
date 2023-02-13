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


    bot.on("chat", (user, message) => {

        const [cmd, ...args] = message.trim().split(' ');

        switch (cmd) {


            case "pickup":
                bot.commonSense.findLocalWater(undefined, 10);
        }

    })
})

