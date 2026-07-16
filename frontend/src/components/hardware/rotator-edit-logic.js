export const DEFAULT_ROTATOR = {
    id: null,
    name: "",
    host: "localhost",
    port: 4532,
    minaz: 0,
    maxaz: 360,
    azimuth_mode: "0_360",
    minel: 0,
    maxel: 90,
    parkaz: null,
    parkel: null,
    aztolerance: 2.0,
    eltolerance: 2.0,
};

export function isEmptyRotatorValue(value) {
    return value === "" || value === null || value === undefined;
}

export function toOptionalNumber(value) {
    if (value === "" || value === null || value === undefined) {
        return null;
    }
    return Number(value);
}

export function applyAzimuthModeDefaults(formValues, azimuthMode) {
    const modeDefaults = {
        "0_360": { minaz: 0, maxaz: 360 },
        "-180_180": { minaz: -180, maxaz: 180 },
        "0_450": { minaz: 0, maxaz: 450 },
    };

    return {
        ...formValues,
        ...(modeDefaults[azimuthMode] || {}),
        azimuth_mode: azimuthMode,
    };
}

export function prepareRotatorPayload(formValues) {
    return {
        ...formValues,
        port: Number(formValues.port),
        minaz: Number(formValues.minaz),
        maxaz: Number(formValues.maxaz),
        minel: Number(formValues.minel),
        maxel: Number(formValues.maxel),
        parkaz: toOptionalNumber(formValues.parkaz),
        parkel: toOptionalNumber(formValues.parkel),
        aztolerance: Number(formValues.aztolerance),
        eltolerance: Number(formValues.eltolerance),
    };
}

export function validateRotatorForm(formValues, t) {
    const validationErrors = {};
    if (!formValues.name?.trim()) validationErrors.name = t("shared.required");
    if (!formValues.host?.trim()) validationErrors.host = t("shared.required");
    if (!formValues.port && formValues.port !== 0) {
        validationErrors.port = t("shared.required");
    } else if (Number(formValues.port) <= 0 || Number(formValues.port) > 65535) {
        validationErrors.port = t("shared.port_range");
    }
    if (isEmptyRotatorValue(formValues.minaz)) {
        validationErrors.minaz = t("shared.required");
    } else if (Number.isNaN(Number(formValues.minaz))) {
        validationErrors.minaz = t("shared.must_be_number");
    }
    if (isEmptyRotatorValue(formValues.maxaz)) {
        validationErrors.maxaz = t("shared.required");
    } else if (Number.isNaN(Number(formValues.maxaz))) {
        validationErrors.maxaz = t("shared.must_be_number");
    }
    if (!isEmptyRotatorValue(formValues.minaz)
        && !isEmptyRotatorValue(formValues.maxaz)
        && Number(formValues.minaz) > Number(formValues.maxaz)) {
        validationErrors.minaz = t("rotator.validation.min_az_lte_max_az");
        validationErrors.maxaz = t("rotator.validation.min_az_lte_max_az");
    }
    if (!["0_360", "-180_180", "0_450"].includes(formValues.azimuth_mode ?? "0_360")) {
        validationErrors.azimuth_mode = t("rotator.validation.invalid_azimuth_mode");
    }
    if (isEmptyRotatorValue(formValues.minel)) {
        validationErrors.minel = t("shared.required");
    } else if (Number.isNaN(Number(formValues.minel))) {
        validationErrors.minel = t("shared.must_be_number");
    }
    if (isEmptyRotatorValue(formValues.maxel)) {
        validationErrors.maxel = t("shared.required");
    } else if (Number.isNaN(Number(formValues.maxel))) {
        validationErrors.maxel = t("shared.must_be_number");
    }
    if (!isEmptyRotatorValue(formValues.minel)
        && !isEmptyRotatorValue(formValues.maxel)
        && Number(formValues.minel) > Number(formValues.maxel)) {
        validationErrors.minel = t("rotator.validation.min_el_lte_max_el");
        validationErrors.maxel = t("rotator.validation.min_el_lte_max_el");
    }
    if (!isEmptyRotatorValue(formValues.parkaz) && Number.isNaN(Number(formValues.parkaz))) {
        validationErrors.parkaz = t("shared.must_be_number");
    }
    if (!isEmptyRotatorValue(formValues.parkel) && Number.isNaN(Number(formValues.parkel))) {
        validationErrors.parkel = t("shared.must_be_number");
    }
    if (isEmptyRotatorValue(formValues.parkaz) !== isEmptyRotatorValue(formValues.parkel)) {
        validationErrors.parkaz = t("rotator.validation.park_both_or_none");
        validationErrors.parkel = t("rotator.validation.park_both_or_none");
    }
    if (isEmptyRotatorValue(formValues.aztolerance)) {
        validationErrors.aztolerance = t("shared.required");
    } else if (Number.isNaN(Number(formValues.aztolerance))) {
        validationErrors.aztolerance = t("shared.must_be_number");
    } else if (Number(formValues.aztolerance) < 0) {
        validationErrors.aztolerance = t("shared.must_be_gte_zero");
    }
    if (isEmptyRotatorValue(formValues.eltolerance)) {
        validationErrors.eltolerance = t("shared.required");
    } else if (Number.isNaN(Number(formValues.eltolerance))) {
        validationErrors.eltolerance = t("shared.must_be_number");
    } else if (Number(formValues.eltolerance) < 0) {
        validationErrors.eltolerance = t("shared.must_be_gte_zero");
    }
    return validationErrors;
}
