# Nextcloud version matrix action

Get a version matrix of server versions to test the app against

## Inputs

### `filename`
**Optional** The path to the `info.xml` for the app, defaults to `appinfo/info.xml`.

## Outputs

### `versions`

List of version number the app supports

### `branches`

Branches for each supported version, either `stableXX` or `master` for versions that aren't released yet

## License
[MIT License](LICENSE.md)
