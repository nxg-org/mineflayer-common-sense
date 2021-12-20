import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { promisify } from "util";
import type { Block } from "prismarine-block";
import md, {Block as mdBlock} from "minecraft-data";
const sleep = promisify(setTimeout);

export class CommonSense {
    public autoRespond: boolean = false;
    public isFalling: boolean = false;
    public isOnFire: boolean = false;
    public checkForFalling: boolean = true;
    public checkForFire: boolean = true;
    public useOffHand: boolean = true;
    public requipLastItem: boolean = false;
    public puttingOutFire: boolean = false;
    public MLGing: boolean = false;
    private waterBlock: mdBlock;
    constructor(public bot: Bot) {
        this.waterBlock = md(this.bot.version).blocksByName["water"]
        this.bot.on("physicsTick", this.isFallingCheckEasy.bind(this));
        this.bot._client.on("entity_metadata", this.onMetadataFireCheck.bind(this));
        this.bot._client.on("entity_status", this.onStatusFireCheck.bind(this));
        // this.bot.on("physicsTick", this.onPhysicsTickFireCheck.bind(this));
        //TODO: Move this to bot movement.
    }

    // async onPhysicsTickFireCheck() {
    //     if ((this.bot.entity.metadata[0] as any) === 1) {
    //         this.isOnFire = true;
    //         while (!this.bot.entity.onGround) await sleep(0);
    //         if (!this.puttingOutFire && this.autoRespond) this.putOutFire();
    //     } else {
    //         this.isOnFire = false
    //     }
    // }

    async onMetadataFireCheck(packet: any) {
        if (!this.checkForFire) return;
        if (!packet.entityId) return;
        const entity = this.bot.entities[packet.entityId];
        if (!entity || entity !== this.bot.entity) return;
        // if ((entity.metadata[0] as any).value !== 1) {
        const wantedKey = (packet.metadata as any[]).findIndex((md) => md.key === 0);
        if (wantedKey === -1) return;
        if (packet.metadata[wantedKey]?.value !== 1) {
            this.isOnFire = false;
            return;
        }
        // }

        this.isOnFire = true;
        while (!this.bot.entity.onGround) await this.bot.waitForTicks(1);
        if (!this.puttingOutFire && this.autoRespond) this.putOutFire();
    }

    async onStatusFireCheck(packet: any) {
        if (!this.checkForFire) return;
        if (!packet.entityId) return;
        const entity = this.bot.entities[packet.entityId];
        if (!entity || entity !== this.bot.entity) return;
        if (!packet.entityStatus || packet.entityStatus !== 37) {
            this.isOnFire = false;
            return;
        }

        this.isOnFire = true;
        while (!this.bot.entity.onGround) await sleep(0);
        if (!this.puttingOutFire && this.autoRespond) this.putOutFire();
    }

    async putOutFire() {
        if (this.puttingOutFire) return true;
        this.puttingOutFire = true;
        const hand = this.bot.util.inv.getHand(this.useOffHand)
        const water = this.bot.util.inv.getAllItemsExceptCurrent(hand).find((item) => item?.name.includes("water_bucket"));
        const holdingItem = this.bot.util.inv.getHandWithItem(this.useOffHand)?.name.includes("water_bucket");
        if (!water && !holdingItem) {
            this.puttingOutFire = false;
            return false;
        } else if (!holdingItem && water) await this.bot.util.inv.customEquip(water, hand);

        if (this.bot.util.inv.getHandWithItem(this.useOffHand)?.name.includes("water_bucket")) {
            const nearbyBlock = this.bot.findBlock({ matching: (block) => block?.name === "fire", maxDistance: 2 });

            if (nearbyBlock) {
                await this.bot.dig(nearbyBlock, true);
                await this.bot.util.move.forceLookAt(nearbyBlock.position.offset(0, -1, 0));
            } else {
                await this.bot.util.move.forceLook(this.bot.entity.yaw, -90);
            }
            // while (!this.bot.entity.isCollidedVertically) await this.bot.waitForTicks(1);
            this.bot.activateItem(this.useOffHand);

            await this.pickUpWater(nearbyBlock);
            this.puttingOutFire = false;
            return true;
        } else {
            this.puttingOutFire = false;
            return false;
        }
    }

    async pickUpWater(nearbyBlock: Block | null = null, maxDistance: number = 2, immediate: boolean = false) {
        if (!immediate) await this.bot.waitForTicks(3);
        const block = this.bot.findBlock({
            point: nearbyBlock?.position ?? this.bot.entity.position,
            matching: (block) => (block.type === this.waterBlock.id) && block.metadata === 0,
            //@ts-expect-error
            useExtraInfo: (block: Block) => {
                return this.bot.util.world.getBlockAABB(block).distanceTo(this.bot.entity.position, 1.62) < 4;
            },
            maxDistance: maxDistance,
        });
        if (block) {
            this.bot.util.move.forceLookAt(block.position.offset(0.5, 0.5, 0.5), true);
            this.bot.activateItem(this.useOffHand);
        } else {
            console.log("didn't get block. fuck.");
        }
    }
    async isFallingCheckEasy() {
        if (!this.checkForFalling) return;
        if (this.bot.entity.velocity.y >= -0.6) {
            this.isFalling = false;
            return;
        }
        this.isFalling = true;
        if (!this.MLGing && this.autoRespond) {
            await this.waterBucket();
        }
    }

    private findBlockForWaterPlacement() {
        const pos = this.bot.entity.position.offset(this.bot.entity.velocity.x, 0, this.bot.entity.velocity.z);
        const aabb = this.bot.util.entity.getEntityAABB({
            position: pos,
            height: this.bot.entity.height,
            width: 0.3,
        });
        const spacing = { x0: aabb.minX, z0: aabb.minZ, x1: aabb.maxX, z1: aabb.maxZ };
        const floored = { x0: Math.floor(spacing.x0), z0: Math.floor(spacing.z0), x1: Math.floor(spacing.x1), z1: Math.floor(spacing.z1) };
        let blocks: Block[] = [];
        const posY = this.bot.entity.position.clone().floored().y;
        loop1: for (let i = floored.x0; i <= floored.x1; i++) {
            loop2: for (let j = floored.z0; j <= floored.z1; j++) {
                loop3: for (let k = posY; k > 0; k--) {
                    const block = this.bot.blockAt(new Vec3(i, k, j));
                    if (!!block && block.type !== 0) {
                        blocks.push(block);
                        break loop3;
                    }
                }
            }
        }

        const maxY = Math.max(...blocks.map((b) => b.position.y));
        blocks = blocks.filter((b) => b.position.y === maxY);

        const block = blocks.sort(
            (a, b) => this.bot.util.world.getBlockAABB(b).distanceTo(pos) - this.bot.util.world.getBlockAABB(a).distanceTo(pos)
        )[0];
        // console.log(block.position, this.bot.entity.position, this.bot.entity.position.distanceTo(block.position).toFixed(2));
        return block;
    }

    async waterBucket() {
        if (this.MLGing) return true;
        this.MLGing = true;
        const hand = this.bot.util.inv.getHand(this.useOffHand)
        const water = this.bot.util.inv.getAllItemsExceptCurrent(hand).find((item) => item?.name.includes("water_bucket"));
        const holdingItem = this.bot.util.inv.getHandWithItem(this.useOffHand)?.name.includes("water_bucket");
        if (!water && !holdingItem) {
            this.MLGing = false;
            return false;
        } else if (!holdingItem && water) await this.bot.util.inv.customEquip(water, hand);

        for (let i = 0; i < 120; i++) {
            const landingBlock = this.findBlockForWaterPlacement();
            if (landingBlock) {
                await this.bot.util.move.forceLookAt(landingBlock.position.offset(0.5, 0.5, 0.5), true);
            }

            if (this.bot.entity.position.y <= (landingBlock?.position.y ?? 0) + 3) {
                this.bot.activateItem(this.useOffHand);
                break;
            }
            await this.bot.waitForTicks(1);
        }
        await this.pickUpWater(null, 2);
        this.MLGing = false;
        return true;
    }
}
