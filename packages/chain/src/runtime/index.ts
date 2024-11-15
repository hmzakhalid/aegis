import { Balance, VanillaRuntimeModules } from "@proto-kit/library";
import { ModulesConfig } from "@proto-kit/common";

import { Balances } from "./modules/balances";
import { PreimageVerifier } from "./modules/preImageVerifier";

export const modules = VanillaRuntimeModules.with({
  Balances,
  PreimageVerifier,
});

export const config: ModulesConfig<typeof modules> = {
  Balances: {
    totalSupply: Balance.from(10_000),
  },
  PreimageVerifier: {},
};

export default {
  modules,
  config,
};
