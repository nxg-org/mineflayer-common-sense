import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { promisify } from "util";
import type { Block } from "prismarine-block";
import type {Block as mdBlock} from "minecraft-data";
const sleep = promisify(setTimeout);


export interface ICommonSenseOptions {
    autoRespond: boolean,
    fallCheck: boolean,
    fireCheck: boolean,
    useOffhand: boolean,
}

export class CommonSense {
    public options: ICommonSenseOptions;
    public isFalling: boolean = false;
    public isOnFire: boolean = false;
    public requipLastItem: boolean = false;
    public puttingOutFire: boolean = false;
    public MLGing: boolean = false;
    private blocksByName: {[name: string]: mdBlock };

    constructor(private bot: Bot, options?: Partial<ICommonSenseOptions>) {
        this.options = Object.assign({ autoRespond: false, fallCheck: false, fireCheck: false, useOffhand: false}, options);
        this.blocksByName = (bot as any).registry.blocksByName;
        this.bot.on("physicsTick", this.isFallingCheckEasy);
        this.bot._client.on("entity_metadata", this.onMetadataFireCheck);
        this.bot._client.on("entity_status", this.onStatusFireCheck);
    }


    public setOptions(options?: Partial<ICommonSenseOptions>) {
        Object.assign(this.options, options);
    }


    private onMetadataFireCheck = async (packet: any) => {
        if (!this.options.fireCheck) return;
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
        if (!this.puttingOutFire && this.options.autoRespond) this.putOutFire();
    }

    private onStatusFireCheck = async (packet: any) => {
        if (!this.options.fireCheck) return;
        if (!packet.entityId) return;
        const entity = this.bot.entities[packet.entityId];
        if (!entity || entity !== this.bot.entity) return;
        if (!packet.entityStatus || packet.entityStatus !== 37) {
            this.isOnFire = false;
            return;
        }

        this.isOnFire = true;
        while (!this.bot.entity.onGround) await this.bot.waitForTicks(1);
        if (!this.puttingOutFire && this.options.autoRespond) this.putOutFire();
    }

    public async putOutFire () {
        if (this.puttingOutFire) return true;
        this.puttingOutFire = true;
        const hand = this.bot.util.inv.getHand(this.options.useOffhand)
        const water = this.bot.util.inv.getAllItemsExceptCurrent(hand).find((item) => item?.name.includes("water_bucket"));
        const holdingItem = this.bot.util.inv.getHandWithItem(this.options.useOffhand)?.name.includes("water_bucket");
        if (!water && !holdingItem) {
            this.puttingOutFire = false;
            return false;
        } else if (!holdingItem && water) {
            await this.bot.util.inv.customEquip(water, hand);
        } 

        if (this.bot.util.inv.getHandWithItem(this.options.useOffhand)?.name.includes("water_bucket")) {
            const nearbyBlock = this.bot.findBlock({ matching: (block) => block?.name === "fire", maxDistance: 3 });

            if (nearbyBlock) {
                await this.bot.dig(nearbyBlock, true);
                await this.bot.util.move.forceLookAt(nearbyBlock.position.offset(0, -1, 0));
            } else {
                const placeBlock = this.findBlockForWaterPlacement();
                if (placeBlock) {
                    await this.bot.util.move.forceLookAt(placeBlock.position.offset(0.5, 0, 0.5));
                } else {
                    await this.bot.util.move.forceLookAt(this.bot.entity.position.offset(0, -1, 0));
                }
         
            }

            // while (!this.bot.entity.isCollidedVertically) await this.bot.waitForTicks(1);
            this.bot.activateItem(this.options.useOffhand);
           
            await this.bot.waitForTicks(3);
            await this.pickUpWater(nearbyBlock);
            this.puttingOutFire = false;
            return true;
        } else {
            this.puttingOutFire = false;
            return false;
        }
    }

    public async pickUpWater(nearbyBlock: Block | null = null, maxDistance: number = 3) {

        const block = this.bot.findBlock({
            point: nearbyBlock?.position ?? this.bot.entity.position,
            matching: (block) => (block.type === this.blocksByName.water.id) && block.metadata === 0 || (block as any)._properties.waterlogged,
            //@ts-expect-error
            useExtraInfo: (block: Block) => {
                return this.bot.util.world.getBlockAABB(block).distanceToVec(this.bot.entity.position.offset(0, 1.62, 0)) < maxDistance;
            },
        });
        if (block) {
            this.bot.util.move.forceLookAt(block.position.offset(0.5, 0.5, 0.5), true);
            this.bot.activateItem(this.options.useOffhand);
        }
    }

    public  isFallingCheckEasy = async () => {
       
        if (!this.options.fallCheck) return;
        if (this.bot.entity.velocity.y >= -0.6) {
            this.isFalling = false;
            return;
        }
        this.isFalling = true;
        if (!this.MLGing && this.options.autoRespond) {
            await this.waterBucket();
        }
    }

    private findBlockForWaterPlacement(): Block | null {
        const pos = this.bot.entity.position //.offset(this.bot.entity.velocity.x, 0, this.bot.entity.velocity.z);
        const aabb = this.bot.util.entity.getEntityAABBRaw(
            {
            position: pos,
            height: this.bot.entity.height,
            width: 0.599, // we are avoiding colliding with adjacent blocks.
        }
        );
        const spacing = { x0: aabb.minX, z0: aabb.minZ, y0: aabb.minY, x1: aabb.maxX, z1: aabb.maxZ };
        const floored = { x0: Math.floor(spacing.x0), z0: Math.floor(spacing.z0), x1: Math.floor(spacing.x1), z1: Math.floor(spacing.z1) };
        let blocks: Block[] = [];
        const posY = this.bot.entity.position.clone().floored().y;
        for (let i = floored.x0; i <= floored.x1; i++) {
            for (let j = floored.z0; j <= floored.z1; j++) {
                loop3: for (let k = posY; k >= 0; k--) {
                    const block = this.bot.blockAt(new Vec3(i, k, j));
                    if (block?.name === "crafting_table") console.log(block);
                    if (!!block && block.type !== this.blocksByName.water.id && block.type !== this.blocksByName.air.id) {
                        blocks.push(block);
                        break loop3;
                    }
                }
            }
        }

        const maxY = Math.max(...blocks.map((b) => b.position.y).filter(y => y < spacing.y0));
        blocks = blocks.filter((b) => b.position.y === maxY);

        const block = blocks.sort(
            (a, b) => this.bot.util.world.getBlockAABB(b).distanceToVec(pos) - this.bot.util.world.getBlockAABB(a).distanceToVec(pos)
        )[0];
        // console.log(block.position, this.bot.entity.position, this.bot.entity.position.distanceTo(block.position).toFixed(2));
        return block ?? null;
    }

    public async waterBucket() {
        if (this.MLGing) return true;
        this.MLGing = true;
        const hand = this.bot.util.inv.getHand(this.options.useOffhand)
        const water = this.bot.util.inv.getAllItemsExceptCurrent(hand).find((item) => item?.name.includes("water_bucket"));
        const holdingItem = this.bot.util.inv.getHandWithItem(this.options.useOffhand)?.name.includes("water_bucket");
     
        if (!water && !holdingItem) {
            this.MLGing = false;
            return false;
        } else if (!holdingItem && water) await this.bot.util.inv.customEquip(water, hand);

        let landingBlock;
        for (let i = 0; i < 120; i++) {
            landingBlock = this.findBlockForWaterPlacement();
            if (landingBlock) {
                await this.bot.util.move.forceLookAt(landingBlock.position.offset(0.5, 0.5, 0.5), true);
                if (this.bot.entity.position.y <= landingBlock.position.y + 3) {
                    if (landingBlock.type !== this.blocksByName.water.id)  this.bot.activateItem(this.options.useOffhand);
                    break;
                }
            }
      
            if (this.bot.blockAt(this.bot.entity.position)?.type === this.blocksByName.water.id) {
                this.MLGing = false;
                return true;
            }
            await this.bot.waitForTicks(1);
        }
        if (landingBlock?.type !== this.blocksByName.water.id) {
            await this.bot.waitForTicks(3);
            await this.pickUpWater(landingBlock, 3);
        }
        this.MLGing = false;
        return true;
    }
}
