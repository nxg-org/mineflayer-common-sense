import type { Bot } from "mineflayer";
import { CommonSense } from "./commonSense";
import {inject} from "./customLoads/place_entity"
import utilPlugin from "@nxg-org/mineflayer-util-plugin";

declare module "mineflayer" {
    interface Bot {
        commonSense: CommonSense;
    }
}

export default function plugin(bot: Bot) {
    if (!bot.util) bot.loadPlugin(utilPlugin)
    bot.commonSense = new CommonSense(bot);
    bot.loadPlugin(inject)
}
