import type { LicenseView } from "../../../../packages/whyfull/src/viewer-types"

export type EnabledLicense = Extract<LicenseView, { enabled: true }>

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`

/** Short state for menus: "Licensed to Ada", "Trial · 3 days left", "Trial ended". */
export function trialLabel(license: EnabledLicense) {
  if (license.licensed)
    return license.holder ? `Licensed to ${license.holder}` : "Licensed"
  return license.trialRemaining > 0
    ? `Trial · ${days(license.trialRemaining)} left`
    : "Trial ended"
}

/** Heading and one supporting line for Settings › License. */
export function licenseStatus(license: EnabledLicense): {
  title: string
  detail: string
} {
  if (license.licensed)
    return {
      title: trialLabel(license),
      detail: license.licenseId ? `License ${license.licenseId}` : "",
    }
  if (license.trialRemaining > 0)
    return {
      title: trialLabel(license),
      detail: `Counted in days of use. ${license.price} once for all your computers.`,
    }
  return {
    title: "Trial ended",
    detail: "Whyfull keeps working, but continued use needs a license.",
  }
}
