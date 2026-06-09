-- Add VECTOR to the AssetType enum so SVG/vector artwork can be stored as a
-- first-class asset type (alongside IMAGE/VIDEO/AUDIO/FONT/LOGO/OTHER) and
-- inserted from the asset library as editable vector layers.
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'VECTOR';
