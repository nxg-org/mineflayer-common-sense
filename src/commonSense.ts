import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import type { Block as mdBlock, Item as string } from "minecraft-data";
import { AABBUtils } from "@nxg-org/mineflayer-util-plugin";
const levenshtein: (str0: string, str1: string) => number = require("js-levenshtein");

const sleep = (ms: number) => new Promise((res, rej) => setTimeout(res, ms));

export interface ICommonSenseOptions {
  autoRespond: boolean;
  fallCheck: boolean;
  fireCheck: boolean;
  useOffhand: boolean;
  mlgItems: string[];
}

export const DefaultCommonSenseOptions: ICommonSenseOptions = {
  autoRespond: false,
  fallCheck: false,
  fireCheck: false,
  useOffhand: false,
  mlgItems: ["sweet_berries", "water_bucket"] as string[],
} as const;

export class CommonSense {
  public isFalling: boolean = false;
  public isOnFire: boolean = false;
  public requipLastItem: boolean = false;
  public puttingOutFire: boolean = false;
  public MLGing: boolean = false;
  public options: ICommonSenseOptions;

  private blocksByName: { [name: string]: mdBlock };
  private causesFire: Set<number>;

  constructor(private bot: Bot, options?: Partial<ICommonSenseOptions>) {
    this.options = Object.assign(DefaultCommonSenseOptions, options);
    this.blocksByName = bot.registry.blocksByName;
    this.bot.on("physicsTick", this.isFallingCheckEasy);
    this.bot._client.on("entity_metadata", this.onMetadataFireCheck);
    this.bot._client.on("entity_status", this.onStatusFireCheck);
    this.causesFire = new Set();
    this.causesFire.add(this.blocksByName.lava.id);
    this.causesFire.add(this.blocksByName.fire.id);
  }

  public setOptions(options: Partial<ICommonSenseOptions>) {
    Object.assign(this.options, options);
    return this.options;
  }

  public isFallingCheckEasy = async () => {
    if (!this.options.fallCheck) return;
    if (this.bot.entity.velocity.y >= -0.6 || (this.bot.entity as any).isInWater) {
      this.isFalling = false;
      return;
    }
    this.isFalling = true;
    if (!this.MLGing && this.options.autoRespond && this.isFalling) {
      console.log("mlg res", await this.waterBucket());
    }
  };

  private onMetadataFireCheck = async (packet: any) => {
    if (!this.options.fireCheck) return;
    if (!packet.entityId) return;
    const entity = this.bot.entities[packet.entityId];
    if (!entity || entity !== this.bot.entity) return;
    const wantedKey = (packet.metadata as any[]).findIndex((md) => md.key === 0);
    if (wantedKey === -1) return;
    if ((packet.metadata[wantedKey]?.value as number & 0x01) !== 0x01) {
      this.isOnFire = false;
      return;
    }

    this.isOnFire = true;
    while (!this.bot.entity.onGround) await this.bot.waitForTicks(1);
    if (!this.puttingOutFire && this.options.autoRespond && this.isOnFire) this.putOutFire();
  };

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
    if (!this.puttingOutFire && this.options.autoRespond && this.isOnFire) this.putOutFire();
  };

  public async putOutFire() {
    if (this.puttingOutFire) return true;
    this.puttingOutFire = true;
    const hand = this.bot.util.inv.getHand(this.options.useOffhand);
    const water = this.bot.util.inv.getAllItemsExceptCurrent(hand).find((item) => item?.name.includes("water_bucket"));
    const holdingItem = this.bot.util.inv.getHandWithItem(this.options.useOffhand)?.name.includes("water_bucket");
    if (!water && !holdingItem) {
      this.puttingOutFire = false;
      return false;
    } else if (!holdingItem && water) {
      await this.bot.util.inv.customEquip(water, hand);
    }

    if (!this.bot.util.inv.getHandWithItem(this.options.useOffhand)?.name.includes("water_bucket")) {
      this.puttingOutFire = false;
      return false;
    }

    const nearbyBlocks = this.reachableFireCauserBlocks();
    let nearbyBlock = null;

    if (nearbyBlocks.length > 0) {
      nearbyBlock = this.bot.blockAt(nearbyBlocks[0])!;

      // solid block, meaning it must be fire.
      if (nearbyBlock.diggable) await this.bot.dig(nearbyBlock, true);
      await this.bot.util.move.forceLookAt(nearbyBlock.position.offset(0.5, -1, 0.5));
    } else {
      const placeBlock = this.findMLGPlacementBlock();
      if (placeBlock) {
        console.log("have placement block, looking there")
        await this.bot.util.move.forceLookAt(placeBlock.position.offset(0.5, 0.5, 0.5));
      } else {
        await this.bot.util.move.forceLookAt(this.bot.entity.position.offset(0, -1, 0));
      }
    }

    // while (!this.bot.entity.isCollidedVertically) await this.bot.waitForTicks(1);
    this.bot.activateItem(this.options.useOffhand);
    await this.bot.waitForTicks(3);
    const waterBlock = await this.findLocalWater(nearbyBlock?.position, 5);
    if (waterBlock) {
      console.log("picking up water", waterBlock.position);
      this.bot.util.move.forceLookAt(waterBlock.position.offset(0.5, 0.5, 0.5), true);
      await this.bot.waitForTicks(3);
      this.bot.activateItem(this.options.useOffhand);
    } else {
      console.log("cant find block");
    }
    this.puttingOutFire = false;
    return true;
  }

  public reachableFireCauserBlocks(maxDistance: number = 3) {
    const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
    return this.bot.findBlocks({
      // placed water will always be on top of wanted block.
      point: this.bot.entity.position,
      matching: (block) =>
        this.causesFire.has(block.type) && AABBUtils.getBlockAABB(block).distanceToVec(eyePos) < maxDistance,
    });
  }

  public async findLocalWater(nearbyBlockPos: Vec3 = this.bot.entity.position, maxDistance: number = 10) {
    const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
    return this.bot.findBlock({
      // placed water will always be on top of wanted block.
      maxDistance: 8,
      point: nearbyBlockPos,
      matching: (block) => {
        const waterSrcCheck = block.type === this.blocksByName.water.id && block.metadata === 0;
        const waterLoggedBlock = (block as any)._properties.waterlogged;
        const distCheck = AABBUtils.getBlockAABB(block).distanceToVec(eyePos) < maxDistance;
        if (waterSrcCheck) console.log(block, distCheck, AABBUtils.getBlockAABB(block).distanceToVec(eyePos))
        return (waterSrcCheck || waterLoggedBlock) && distCheck;
      },
      useExtraInfo: true,
    });

  }

  private findMLGPlacementBlock(): Block | null {
    const pos = this.bot.entity.position; //.offset(this.bot.entity.velocity.x, 0, this.bot.entity.velocity.z);
    const aabb = AABBUtils.getEntityAABBRaw({
      position: pos,
      height: this.bot.entity.height,
      width: 0.599, // we are avoiding colliding with adjacent blocks.
    });
    const floored = {
      x0: Math.floor(aabb.minX),
      z0: Math.floor(aabb.minZ),
      x1: Math.floor(aabb.maxX),
      z1: Math.floor(aabb.maxZ),
    };
    let blocks: Block[] = [];
    const posY = Math.floor(this.bot.entity.position.y);

    const cursor = new Vec3(floored.x0, posY, floored.z0);
    // console.log(cursor.x, floored.x0, floored.x1, cursor.z, floored.z0, floored.z1);
    for (cursor.x = floored.x0; cursor.x <= floored.x1; cursor.x++) {
      for (cursor.z = floored.z0; cursor.z <= floored.z1; cursor.z++) {
        // console.log("searching", cursor);
        loop3: for (cursor.y = posY; cursor.y >= (this.bot.game as any).minY; cursor.y--) {
          const block = this.bot.blockAt(cursor);
          if (!block) continue;
          if (
            block.type !== this.blocksByName.water.id &&
            block.type !== this.blocksByName.air.id &&
            !block.transparent
          ) {
            // console.log("found at", cursor, block.position);
            blocks.push(block);
            break loop3;
          }
        }
      }
    }

    // console.log(this.bot.game)

    // console.log(aabb);
    // console.log("before filter", blocks.map((b) => b.position));
    blocks = blocks.filter((b) => b.position.y <= aabb.minY);
    const maxY = Math.max(...blocks.map((b) => b.position.y));
    blocks = blocks.filter((b) => b.position.y === maxY);
    // console.log("after filter", blocks.map((b) => b.position));
    const block = blocks.sort(
      (a, b) => AABBUtils.getBlockAABB(b).distanceToVec(pos) - AABBUtils.getBlockAABB(a).distanceToVec(pos)
    )[0];
    // console.log(block.position, this.bot.entity.position, this.bot.entity.position.distanceTo(block.position).toFixed(2));
    return block ?? null;
  }

  public getMLGItem() {
    for (const mlgName of this.options.mlgItems) {
      const toEquip = this.bot.util.inv.getAllItems().find((item) => item?.name.includes(mlgName));
      if (toEquip) return toEquip;
    }
    return null;
  }

  public async waterBucket() {
    if (this.MLGing) return true;

    const mlgItem = this.getMLGItem();
    const heldItem = this.bot.util.inv.getHandWithItem(this.options.useOffhand);

    if (!mlgItem) {
      console.log("no item!");
      return false;
    }

    this.MLGing = true;
    this.bot.placeBlock;
    const hand = this.bot.util.inv.getHand(this.options.useOffhand);

    if (heldItem?.name !== mlgItem.name) {
      await this.bot.util.inv.customEquip(mlgItem, hand);
    }

    const placeable = mlgItem.stackSize > 1;

    let landingBlock: Block | null = null;
    let landingBlockSolid = true;
    for (let i = 0; i < 120; i++) {
      landingBlock = this.findMLGPlacementBlock();
      console.log(landingBlock);
      if (landingBlock) {
        landingBlockSolid = landingBlock.type !== this.blocksByName.water.id;
        this.bot.util.move.forceLookAt(landingBlock.position.offset(0.5, 1, 0.5), true);
        if (this.bot.entity.position.y <= landingBlock.position.y + 3) {
          console.log("placing!")
          if (landingBlockSolid) {
            
            if (!placeable) this.bot.activateItem(this.options.useOffhand);
            else
              console.log(
                await this.naivePlaceAndCheck(mlgItem, landingBlock, new Vec3(0, 1, 0), {
                  offhand: this.options.useOffhand,
                  swingArm: hand,
                })
              );
          }
          break;
        }
      }

      if (this.bot.blockAt(this.bot.entity.position)?.type === this.blocksByName.water.id) {
        console.log("this shouldn't be triggering.");
        this.MLGing = false;
        return true;
      }
      await this.bot.waitForTicks(1);
    }

    if (landingBlockSolid) {
      await this.bot.waitForTicks(3);
      const waterBlock = await this.findLocalWater(landingBlock!.position, 5);
      if (waterBlock) {
        console.log("picking up water", waterBlock.position);
        this.bot.util.move.forceLookAt(waterBlock.position.offset(0.5, 0.5, 0.5), true);
        await this.bot.waitForTicks(3);
        this.bot.activateItem(this.options.useOffhand);
      } else {
        console.log("cant find block");
      }
    }

    console.log("successful mlg");
    this.MLGing = false;
    return true;
  }

  private async naivePlaceAndCheck(item: Item, block: Block, placeVector: Vec3, options: any) {
    const dest = block.position.plus(placeVector);
    let ret = false;

    // BAD way of checking correlation between item to place and block.
    // Ideally, we'd link every item to their placement counterpart.
    const listener = (oldBlock: Block | null, newBlock: Block) => {
      if (oldBlock?.type === newBlock.type) {
        if (levenshtein(item.name, oldBlock.name) < 8) {
          console.log("same block from item");
          ret = true;
        }
      }

      this.bot.off(`blockUpdate:${dest}` as any, listener);
    };
    this.bot.prependOnceListener(`blockUpdate:${dest}` as any, listener);
    try {
      await (this.bot as any)._placeBlockWithOptions(block, placeVector, options);
      return true;
    } catch (e) {
      return ret;
    }
  }
}
