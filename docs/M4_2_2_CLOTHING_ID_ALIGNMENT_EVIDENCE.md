# M4.2.2 Clothing ID Alignment Evidence

Last updated: 2026-09-03

## Scope

This evidence step verifies whether `clothes[]` returned by the already-verified NUAN5-compatible photo resolver uses the same entity-ID space as Infinity Nikki game/client clothing assets.

The user explicitly authorized exactly one repeat request for the same previously validated photo. This authorization does **not** enable batch resolution, background resolution, default provider activation, or any additional photo request.

Target asset:

```text
asset_21aa2ad824a1937002a1f6eaed1af6e0
UID 100826934
2025_07_28_22_11_10_242641.jpeg
```

Only the existing embedded UID/tuple/MD5 protocol inputs were sent. JPEG/MP4 bytes, thumbnails and local paths were not uploaded.

## Result

The provider returned HTTP 200 and exactly 14 clothing/entity IDs:

```text
1020100111
1020600111
1020710111
1020730111
1020740111
1020750111
1020810145
1020820183
1020830126
1020840126
1020850162
1020900111
1020970111
1023860042
```

For this photo the raw response did not expose a usable `filter.f` or `light.l` ID (`null` in the bounded probe), so this request provides clothing/entity alignment evidence only.

## Alignment conclusion

Before this request, independent public game-data inspection had already found Infinity Nikki clothing asset IDs such as:

```text
1020100082  hair
1020200082  outerwear
1020300082  top
1020410082  bottoms
1020600082  shoes
1020720082  headwear
1020770082  gloves
1020950082  backpiece
1020980082  pendant

1020100396  hair
1020200396  outerwear
1020600396  shoes
1020720396  headwear
1020740396  neckwear
1020750396  bracelet
1020780396  handheld
1020900396  dress
```

The real NUAN5 `clothes[]` values are in this same 10-digit game entity-ID space. In particular, independently established slot segments recur in the live response (`10`, `60`, `74`, `75`, `90`), rather than a separate website/catalogue ID space.

Therefore M4.2.2 establishes the following interoperability fact:

```text
NUAN5 clothes[] ID
        =
Infinity Nikki game entity ID space
```

This is sufficient to use game/client-derived dictionaries as the preferred source for `clothing` enrichment instead of introducing a NUAN5-specific clothing-ID translation layer.

## Still unresolved

Do not over-interpret slot/category codes that have not yet been independently aligned. In particular these observed segments still need local-client table evidence before assigning canonical names/categories:

```text
71
73
81
82
83
84
85
97
386
```

`81`–`85` appear as a cluster in one real appearance record, but their semantic category must not be guessed. `1023860042` also uses a different middle-code shape and requires direct game-data evidence.

## Next step

Proceed to M4.2.2B: inspect the locally installed Infinity Nikki data tables/string tables/localization resources and locate records keyed by the returned IDs. The target proof is:

```text
102xxxxxxxx
  -> canonical item name
  -> category/slot
  -> rarity
  -> icon/thumbnail asset reference
```

Prefer local-client extraction so a game update can refresh entity data without an Android APK update. Keep the M4.2.1 remote dictionary updater as an optional fallback/hotfix transport.

