{
  description = "MISU - Rust (axum + SQLite) backend dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # System deps needed to build the backend crates.
        # sqlx uses bundled SQLite and reqwest/sqlx use rustls, so no OpenSSL
        # or system SQLite is required. The macOS SDK frameworks are supplied
        # automatically by the default stdenv on Darwin.
        buildInputs = with pkgs; [
          libiconv
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          inherit buildInputs;

          nativeBuildInputs = with pkgs; [
            rustc
            cargo
            rustfmt
            clippy
            rust-analyzer
            pkg-config
            sqlite # `sqlite3` CLI for inspecting misu.sqlite
          ];

          RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";

          shellHook = ''
            echo "MISU dev shell — $(cargo --version)"
            echo "Run the backend with: (cd apps/backend && cargo run)"
          '';
        };
      });
}
