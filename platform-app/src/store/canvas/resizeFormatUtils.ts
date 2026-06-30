import type { ResizeFormat } from "@/types";

export function getMasterResize(resizes: ResizeFormat[]): ResizeFormat | undefined {
    return resizes.find((resize) => resize.isMaster)
        ?? resizes.find((resize) => resize.id === "master")
        ?? resizes[0];
}
