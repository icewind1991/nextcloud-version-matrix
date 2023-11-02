{
  inputs = {
    utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "nixpkgs/release-23.05";
  };

  outputs = {
    self,
    nixpkgs,
    utils
  }:
  utils.lib.eachDefaultSystem (system: let
      pkgs = (import nixpkgs) {
        inherit system;
      };
    in rec {
      # `nix develop`
      devShell = pkgs.mkShell {
        nativeBuildInputs = with pkgs; [
            nodejs_20
        ];
      };
    });
}
