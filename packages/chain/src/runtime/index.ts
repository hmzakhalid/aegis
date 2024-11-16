import "reflect-metadata";
import { Balance, VanillaRuntimeModules } from "@proto-kit/library";
import { ModulesConfig } from "@proto-kit/common";

import { Balances } from "./modules/balances";
import { ShieldedPool } from "./modules/shieldedPool";

export const modules = VanillaRuntimeModules.with({
  Balances,
  ShieldedPool,
});

export const config: ModulesConfig<typeof modules> = {
  Balances: {
    totalSupply: Balance.from(10_000),
  },
  ShieldedPool: {},
};

export default {
  modules,
  config,
};
