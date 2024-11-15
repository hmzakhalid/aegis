{
  description = "Node.js 18 development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-23.11"; # Add stable nixpkgs
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, nixpkgs-stable }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        # Specify Node.js 18
        nodejs = pkgs.nodejs_18;
        
        pkgs-stable = nixpkgs-stable.legacyPackages.${system}; # Add stable pkgs

        # Optional: include npm and development tools
        nodeDevTools = [
          nodejs
          pkgs.pnpm
          pkgs-stable.nodePackages_latest.prisma # Use prisma from stable
        ];
      in
      {
        packages = {
          nodejs = nodejs;
          default = nodejs;
        };

        devShell = pkgs.mkShell {
          buildInputs = nodeDevTools;
          shellHook = ''
            export PRISMA_QUERY_ENGINE_LIBRARY=${pkgs-stable.prisma-engines}/lib/libquery_engine.node
            export PRISMA_QUERY_ENGINE_BINARY=${pkgs-stable.prisma-engines}/bin/query-engine
            export PRISMA_SCHEMA_ENGINE_BINARY=${pkgs-stable.prisma-engines}/bin/schema-engine
          '';
        };
      }
    );
}
