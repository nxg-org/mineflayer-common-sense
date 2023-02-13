import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import type { Block as mdBlock, Item as mdItem } from "minecraft-data";
import { AABBUtils } from "@nxg-org/mineflayer-util-plugin";

const sleep = (ms: number) => new Promise((res, rej) => setTimeout(res, ms));

export interface ICommonSenseOptions {
  autoRespond: boolean;
  fallCheck: boolean;
  fireCheck: boolean;
  useOffhand: boolean;

}

export const DefaultCommonSenseOptions: ICommonSenseOptions = {
  autoRespond: false,
  fallCheck: false,
  fireCheck: false,
  useOffhand: false,
} as const;

export class CommonSense {
 
  public isFalling: boolean = false;
  public isOnFire: boolean = false;
  public requipLastItem: boolean = false;
  public puttingOutFire: boolean = false;
  public MLGing: boolean = false;
  public options: ICommonSenseOptions;

  private _mlgItems: mdItem[] = [];

  private itemsByName: {[name: string]: mdItem}
  private blocksByName: { [name: string]: mdBlock };
  private causesFire: Set<number>;

  constructor(private bot: Bot, options?: Partial<ICommonSenseOptions>) {
    this.options = Object.assign(DefaultCommonSenseOptions, options);
    this.itemsByName = bot.registry.itemsByName;
    this.blocksByName = bot.registry.blocksByName;
    this.bot.on("physicsTick", this.isFallingCheckEasy);
    this.bot._client.on("entity_metadata", this.onMetadataFireCheck);
    this.bot._client.on("entity_status", this.onStatusFireCheck);
    this.causesFire = new Set();
    this.causesFire.add(this.blocksByName.lava.id);
    this.causesFire.add(this.blocksByName.fire.id);
  }

  public setMLGItems(items: string[] | mdItem[]) {
    if (items.length === 0) {
      this._mlgItems = [];
      return;
    }

    if ((items[0] as mdItem).id) {
        this._mlgItems = items as mdItem[]
    }

    for (const item of items as string[]) {
      this._mlgItems ||= []
      this._mlgItems.push(this.itemsByName[item]);
    }
  }

  public setOptions(options: Partial<ICommonSenseOptions>) {
    Object.assign(this.options, options)
    return this.options;
  }

  public isFallingCheckEasy = async () => {
    if (!this.options.fallCheck) return;
    if (this.bot.entity.velocity.y >= -0.6) {
      this.isFalling = false;
      return;
    }
    this.isFalling = true;
    if (!this.MLGing && this.options.autoRespond && this.isFalling) {
      await this.waterBucket();
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
        await this.bot.util.move.forceLookAt(placeBlock.position.offset(0.5, 0.5, 0.5));
      } else {
        await this.bot.util.move.forceLookAt(this.bot.entity.position.offset(0, -1, 0));
      }
    }

    // while (!this.bot.entity.isCollidedVertically) await this.bot.waitForTicks(1);
    this.bot.activateItem(this.options.useOffhand);
    await this.bot.waitForTicks(3);
    await this.pickUpWater(nearbyBlock?.position);
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

  public async pickUpWater(nearbyBlockPos: Vec3 = this.bot.entity.position, maxDistance: number = 3) {
    const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
    const block = this.bot.findBlock({
      // placed water will always be on top of wanted block.
      point: nearbyBlockPos,
      matching: (block) => {
        const waterSrcCheck = block.type === this.blocksByName.water.id && block.metadata === 0;
        const waterLoggedBlock = (block as any)._properties.waterlogged;
        const distCheck = AABBUtils.getBlockAABB(block).distanceToVec(eyePos) < maxDistance;
        return (waterSrcCheck || waterLoggedBlock) && distCheck;
      },
      useExtraInfo: true
    });
    if (block) {
      this.bot.util.move.forceLookAt(block.position.offset(0.5, 0.5, 0.5), true);
      this.bot.activateItem(this.options.useOffhand);
    }
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
    const cursor = new Vec3(floored.x0, floored.z0, posY)
    for (; cursor.x <= floored.x1; cursor.x++) {
      for (; cursor.z <= floored.z1; cursor.z++) {
        loop3: for (; cursor.y >= 0; cursor.y--) {
          const block = this.bot.blockAt(cursor);
          if (!!block && block.type !== this.blocksByName.water.id && block.type !== this.blocksByName.air.id) {
            blocks.push(block);
            break loop3;
          }
        }
      }
    }

    const maxY = Math.max(...blocks.map((b) => b.position.y).filter((y) => y < aabb.minY));
    blocks = blocks.filter((b) => b.position.y === maxY);

    const block = blocks.sort(
      (a, b) => AABBUtils.getBlockAABB(b).distanceToVec(pos) - AABBUtils.getBlockAABB(a).distanceToVec(pos)
    )[0];
    // console.log(block.position, this.bot.entity.position, this.bot.entity.position.distanceTo(block.position).toFixed(2));
    return block ?? null;
  }

  public getMLGItem() {
    for (const mlgName of this._mlgItems) {
      const toEquip = this.bot.util.inv.getAllItems().find((item) => item?.name === mlgName.name);
      if (toEquip) return toEquip
    }
    return null;
  }

  public async waterBucket() {
    if (this.MLGing) return true;
    this.MLGing = true;
    const hand = this.bot.util.inv.getHand(this.options.useOffhand);
    const mlgItem = this.getMLGItem();
    const heldItem = this.bot.util.inv.getHandWithItem(this.options.useOffhand);

    if (!mlgItem) {
      this.MLGing = false;
      return false;
    } 
    
    if (heldItem?.name === mlgItem.name) {
      await this.bot.util.inv.customEquip(mlgItem, hand);
    }

    const placeable = mlgItem.stackSize > 1;

    let landingBlock: Block | null = null;
    let landingBlockSolid = true;
    for (let i = 0; i < 120; i++) {
      landingBlock = this.findMLGPlacementBlock();
      if (landingBlock) {
        landingBlockSolid = landingBlock.type !== this.blocksByName.water.id;
        await this.bot.lookAt(landingBlock.position.offset(0.5, 0.5, 0.5), true);
        if (this.bot.entity.position.y <= landingBlock.position.y + 3) {
          if (landingBlockSolid) {
            if (!placeable) this.bot.activateItem(this.options.useOffhand);
            else this.bot.placeBlock(landingBlock, new Vec3(0, 1, 0));
          }
          break;
        }
      }

      if (this.bot.blockAt(this.bot.entity.position)?.type === this.blocksByName.water.id) {
        this.MLGing = false;
        return true;
      }
      await this.bot.waitForTicks(1);
    }

    if (!landingBlockSolid) {
      await this.bot.waitForTicks(3);
      await this.pickUpWater(landingBlock!.position, 3);
    }
    this.MLGing = false;
    return true;
  }
}
