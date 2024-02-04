import type { Bot, BotEvents } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import type { Entity } from "prismarine-entity";
import type { Block as mdBlock } from "minecraft-data";
import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";

const { Physics, PlayerState } = require("prismarine-physics");
const levenshtein: (str0: string, str1: string) => number = require("js-levenshtein");

const sleep = (ms: number) => new Promise((res, rej) => setTimeout(res, ms));

type MlgItemInfo = {
  name: string;
  maxDistance?: number;
  disallowedDimensons?: string[];
  allowedBlocks?: string[];
};
export interface ICommonSenseOptions {
  autoRespond: boolean;
  useOffhand: boolean;
  reach: number;
  fireCheck: boolean;
  mlgCheck: boolean | { predictTicks: number; mountOnly?: boolean };
  mlgItems: MlgItemInfo[];
  mlgVehicles: string[];
  mlgMountFirst: boolean;
  strictMlgNameMatch: boolean;
  strictMlgBlockMatch: boolean;
}

export const DefaultCommonSenseOptions: ICommonSenseOptions = {
  autoRespond: false,
  mlgCheck: false,
  mlgMountFirst: false,
  fireCheck: false,
  useOffhand: false,
  reach: 4,
  mlgItems: [
    { name: "water_bucket", disallowedDimensons: ["nether"] },
    { name: "boat", maxDistance: 30 },
    { name: "sweet_berries", allowedBlocks: ["grass"] },
    { name: "slime_block" },
    { name: "hay_block" },
  ] as MlgItemInfo[],
  mlgVehicles: ["horse", "boat", "donkey", "mule", "minecart"] as string[],
  strictMlgNameMatch: false,
  strictMlgBlockMatch: false,
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
    this.bot.on("death", () => {
      this.MLGing = false;
      this.isFalling = false;
    });
    this.causesFire = new Set();
    this.causesFire.add(this.blocksByName.lava.id);
    this.causesFire.add(this.blocksByName.fire.id);
    if (!this.options.mlgVehicles.includes("boat")) this.options.mlgVehicles.push("boat");
  }

  public setOptions(options: Partial<ICommonSenseOptions>) {
    Object.assign(this.options, options);
    return this.options;
  }

  public isFallingCheckEasy = async () => {
    if (!this.options.mlgCheck) return;
    if (this.bot.entity.velocity.y >= -0.6 || (this.bot.entity as any).isInWater) {
      this.isFalling = false;
      return;
    }
    this.isFalling = true;
    if (!this.MLGing && this.options.autoRespond && this.isFalling) {
      if (this.options.mlgCheck instanceof Object) {
        this.options.mlgCheck.mountOnly ? await this.entityMountMLG() : this.placementMLG();
      } else {
        await this.placementMLG();
      }
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
    if (!this.options.autoRespond) return;
    if (this.bot.game.dimension.includes("nether")) return; // don't handle fire here.
    while (!this.bot.entity.onGround || this.MLGing) await this.bot.waitForTicks(1);
    if (!this.puttingOutFire && this.isOnFire && !(this.bot.entity as any).isInWater) this.putOutFire();
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
    if (!this.options.autoRespond) return;
    if (this.bot.game.dimension.includes("nether")) return; // don't handle fire here.
    while (!this.bot.entity.onGround || this.MLGing) await this.bot.waitForTicks(1);
    if (!this.puttingOutFire && this.isOnFire && !(this.bot.entity as any).isInWater) this.putOutFire();
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
      await this.bot.equip(water, hand);
    }

    if (!this.bot.util.inv.getHandWithItem(this.options.useOffhand)?.name.includes("water_bucket")) {
      this.puttingOutFire = false;
      return false;
    }

    const nearbyBlock = this.bot.findBlock({ matching: (block) => this.causesFire.has(block.type), maxDistance: 3 });

    if (nearbyBlock) {
      // solid block, meaning it must be fire.
      if (nearbyBlock.diggable) await this.bot.dig(nearbyBlock, true);
      await this.bot.util.move.forceLookAt(nearbyBlock.position.offset(0.5, -1, 0.5));
    } else {
      const placeBlock = this.findMLGPlacementBlock();
      if (placeBlock) {
        console.log("have placement block, looking there");
        await this.bot.util.move.forceLookAt(placeBlock.position.offset(0.5, 0.5, 0.5));
      } else {
        await this.bot.util.move.forceLookAt(this.bot.entity.position.offset(0, -1, 0));
      }
    }

    // while (!this.bot.entity.isCollidedVertically) await this.bot.waitForTicks(1);
    this.bot.activateItem(this.options.useOffhand);
    const checkPos = nearbyBlock?.position ?? this.bot.entity.position;
    await waitFor(this.bot, `blockUpdate`, {
      timeout: 500,
      listener: (old, nw: Block) =>
        nw.type === this.bot.registry.blocksByName.water.id && nw.position.xzDistanceTo(checkPos) < 3,
    });
    await this.pickUpWater(nearbyBlock?.position, 5);
    this.puttingOutFire = false;
    return true;
  }

  public reachableFireCauserBlocks(maxDistance: number = this.options.reach) {
    const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
    return this.bot.findBlocks({
      maxDistance: 8,
      // placed water will always be on top of wanted block.
      point: this.bot.entity.position,
      matching: (block) =>
        this.causesFire.has(block.type) && AABBUtils.getBlockAABB(block).distanceToVec(eyePos) < maxDistance,
    });
  }

  public findLocalWater(nearbyBlockPos: Vec3 = this.bot.entity.position, maxDistance: number = this.options.reach) {
    const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
    return this.bot.findBlock({
      // placed water will always be on top of wanted block.
      maxDistance: 8,
      point: nearbyBlockPos,
      matching: (block) => {
        const waterSrcCheck = block.type === this.blocksByName.water.id && block.metadata === 0;
        const waterLoggedBlock = (block as any)._properties.waterlogged;
        const distCheck = AABBUtils.getBlockAABB(block).distanceToVec(eyePos) < maxDistance;
        return (waterSrcCheck || waterLoggedBlock) && distCheck;
      },
      useExtraInfo: true,
    });
  }

  private findMLGPlacementBlock(): Block | null {
    let pos: Vec3;
    if (this.options.mlgCheck instanceof Object) {
      const playerState: any = new PlayerState(this.bot, this.bot.controlState);
      (this.bot.physics as any).simulatePlayer(playerState, this.bot.world); // in place transition
      pos = playerState.pos;
    } else {
      pos = this.bot.entity.position;
    }

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
    for (cursor.x = floored.x0; cursor.x <= floored.x1; cursor.x++) {
      for (cursor.z = floored.z0; cursor.z <= floored.z1; cursor.z++) {
        loop3: for (cursor.y = posY; cursor.y >= (this.bot.game as any).minY; cursor.y--) {
          const block = this.bot.blockAt(cursor);
          if (!block) continue;
          if (
            block.type !== this.blocksByName.water.id &&
            block.type !== this.blocksByName.air.id &&
            !block.transparent
          ) {
            blocks.push(block);
            break loop3;
          }
        }
      }
    }

    blocks = blocks.filter((b) => b.position.y < aabb.minY);
    const maxY = Math.max(...blocks.map((b) => b.position.y));
    blocks = blocks.filter((b) => b.position.y === maxY);
    const block = blocks.sort(
      (a, b) => AABBUtils.getBlockAABB(a).distanceToVec(pos) - AABBUtils.getBlockAABB(b).distanceToVec(pos)
    )[0];
    return block ?? null;
  }

  public getMLGItem(orgHeight: number, landingBlock: Block) {
    for (const mlgInfo of this.options.mlgItems) {
      if (mlgInfo.maxDistance !== undefined && mlgInfo.maxDistance < orgHeight - landingBlock.position.y) continue;
      // console.log(landingBlock, mlgInfo, mlgInfo.allowedBlocks?.some((name) => landingBlock.name.includes(name)));

      if (this.options.strictMlgBlockMatch && mlgInfo.allowedBlocks !== undefined) {
        if (!mlgInfo.allowedBlocks.some((name) => landingBlock.name === name)) continue;
      } else if (mlgInfo.allowedBlocks !== undefined) {
        if (!mlgInfo.allowedBlocks.some((name) => landingBlock.name.includes(name))) {
          continue;
        }
      }

      if (mlgInfo.disallowedDimensons !== undefined) {
        if (mlgInfo.disallowedDimensons.some(name => this.bot.game.dimension.includes(name))) continue;
      }

      if (this.options.strictMlgNameMatch) {
        const toEquip = this.bot.util.inv.getAllItems().find((item) => item?.name === mlgInfo.name);
        if (toEquip) return toEquip;
      } else {
        const toEquip = this.bot.util.inv.getAllItems().find((item) => item?.name.includes(mlgInfo.name));
        if (toEquip) return toEquip;
      }
    }
    return null;
  }

  private mountEntityFilter = (e: Entity) => {
    const namecheck = this.options.mlgVehicles.some((name) => e.name?.toLowerCase().includes(name.toLowerCase()));
    const distCheck = e.position.distanceTo(this.bot.entity.position) < this.options.reach;
    return namecheck && distCheck;
  };
  public async entityMountMLG(override = false) {
    if (this.MLGing && !override) return true;

    this.MLGing = true;
    for (let i = 0; i < 1000; i++) {
      const e = this.bot.nearestEntity(this.mountEntityFilter);
      if (e) {
        this.bot.util.move.forceLookAt(AABBUtils.getEntityAABB(e).getCenter(), true);
        if (["horse", "donkey", "mule"].some((name) => e.name?.toLowerCase().includes(name))) {
          this.bot.unequip("hand");
        }

        this.bot.mount(e);
        await waitFor(this.bot, "mount");
        this.bot.dismount();
        break;
      }

      await this.bot.waitForTicks(1);
    }

    this.MLGing = false;
    return true;
  }

  // this logic does not work for spawn eggs.
  private findMLGItemType(item: Item) {
    let type = 1; // placeable block (placeBlock)
    if (item.stackSize === 1) type--; // 0 for single stack items (activateItem)
    if (["boat"].some((name) => item!.name.includes(name))) type += 2; // 2 for entitySpawns (placeEntity)

    return type;
  }

  public async placementMLG(): Promise<boolean> {
    if (this.MLGing) return true;
    let landingBlock: Block | null = this.findMLGPlacementBlock();
    if (!landingBlock) return false; // no blocks til void beneath us...

    const startHeight = this.bot.entity.position.y;
    let mlgItem = this.getMLGItem(startHeight, landingBlock);
    const heldItem = this.bot.util.inv.getHandWithItem(this.options.useOffhand);

    if (!mlgItem) return await this.entityMountMLG(true);

    this.MLGing = true;

    const hand = this.bot.util.inv.getHand(this.options.useOffhand);
    for (let i = 0; i < 1000; i++) {
      if (this.bot.blockAt(this.bot.entity.position)?.type === this.blocksByName.water.id) {
        this.MLGing = false;
        return true;
      }

      landingBlock = this.findMLGPlacementBlock();
      if (!landingBlock) return false; // no blocks til void beneath us...

      mlgItem = this.getMLGItem(startHeight, landingBlock) ?? mlgItem;

      if (heldItem?.name !== mlgItem.name) {
        await this.bot.equip(mlgItem, hand);
      }

      if (this.bot.entity.position.y <= landingBlock.position.y + this.options.reach) {
        this.bot.util.move.forceLookAt(landingBlock.position.offset(0.5, 1, 0.5), true);
        if (landingBlock.type !== this.blocksByName.water.id) break;
      }

      await this.bot.waitForTicks(1);
    }

    switch (this.findMLGItemType(mlgItem)) {
      case 0:
        this.bot.activateItem(this.options.useOffhand);
        if (mlgItem.name === "water_bucket") {
          await waitFor(this.bot, `blockUpdate`, {
            timeout: 500,
            listener: (old, nw: Block) =>
              nw.type === this.bot.registry.blocksByName.water.id &&
              nw.position.xzDistanceTo(this.bot.entity.position) < 2,
          });

          try {
            await this.waitForBBCollision(landingBlock!.position, 500);
          } catch {
            return false;
          }
          
          await this.pickUpWater(landingBlock!.position, 5);
        }
        break;
      case 1:
        await this.naivePlaceAndCheck(mlgItem, landingBlock, new Vec3(0, 1, 0), {
          offhand: this.options.useOffhand,
          swingArm: hand,
        });
        break;
      case 2:
        if (!this.bot.nearestEntity(this.mountEntityFilter)) {
          (this.bot as any)._placeEntityWithOptions(landingBlock, new Vec3(0, 1, 0), {
            offhand: this.options.useOffhand,
            swingArm: hand,
          });
        }
        return await this.entityMountMLG(true);
      // return this.entityMountMLG(true);
    }

    this.MLGing = false;
    return true;
  }

  private pickUpWater(pos: Vec3 = this.bot.entity.position, dist: number = this.options.reach) {
    const waterBlock = this.findLocalWater(pos, dist);
    if (waterBlock) {
      this.bot.util.move.forceLookAt(waterBlock.position.offset(0.5, 0.5, 0.5), true);
      if (this.bot.util.inv.getHandWithItem(this.bot.commonSense.options.useOffhand)?.name === "bucket")
        this.bot.activateItem(this.options.useOffhand);
    }
  }

  private async naivePlaceAndCheck(item: Item, block: Block, placeVector: Vec3, options: any) {
    const dest = block.position.plus(placeVector);
    let ret = false;

    // BAD way of checking correlation between item to place and block.
    // Ideally, we'd link every item to their placement counterpart.
    const listener = (oldBlock: Block | null, newBlock: Block) => {
      if (oldBlock?.type === newBlock.type) {
        if (levenshtein(item.name, oldBlock.name) < 8) {
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

  private waitForBBCollision(bPos: Vec3, timeout: number = 500) {
    const bb = AABB.fromVecs(bPos, bPos.offset(1, 1, 1));
    
    return new Promise<void>((res, rej) => {
      const listener = (pos: Vec3) => {
        const bb1 = AABBUtils.getPlayerAABB(this.bot.entity);
        if (bb.collides(bb1)) {
          this.bot.off("move", listener);
          res();
        }
      }

      this.bot.on("move", listener);
      setTimeout(rej, timeout);
    })
  }
}

function waitFor<Event extends keyof BotEvents>(
  bot: Bot,
  event: Event,
  options?: { timeout: number; listener?: (...args: Parameters<BotEvents[Event]>) => boolean }
): Promise<Parameters<BotEvents[Event]>> {
  return new Promise((res, rej) => {
    const internal = (...args: Parameters<BotEvents[Event]>) => {
      if (!!options?.listener) {
        const ret = options.listener(...args);
        if (ret) {
          bot.off(event, internal as any);
          res(args);
        }
      } else {
        bot.off(event, internal as any);
        res(args);
      }
    };
    bot.on(event, internal as any);
    if (!!options?.timeout) {
      setTimeout(res, options.timeout);
    }
  });
}
