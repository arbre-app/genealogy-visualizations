import { ORIENTATION_HORIZONTAL, ORIENTATION_VERTICAL } from '../common';
import { adaptTextSize, createElement, createSVG, deepMerge } from '../util';
import * as Joi from 'joi';
import { configSchema, dataSchema, layersSchema } from './schema';

// Computations and drawing

function getLayerConfig(previous, current) {
    return deepMerge(previous, current || {});
}

function computeBoxDimensions(layerConfig) {
    if(layerConfig.orientation === ORIENTATION_HORIZONTAL) {
        const width = 2 * layerConfig.padding.sides + layerConfig.textLength;
        const height = layerConfig.padding.top + layerConfig.padding.bottom + layerConfig.texts.length * layerConfig.textSize + (layerConfig.texts.length - 1) * layerConfig.padding.textSpacing;
        return { width, height };
    } else if(layerConfig.orientation === ORIENTATION_VERTICAL) {
        return null; // TODO implement
    } else {
        return null;
    }
}

function computeAscendingProperties(data, config) {
    const maxDepth = config.generations.ascending;
    let individualIds = new Set([data.rootIndividualId]);
    let isEmpty = false;
    let depth = 0;
    let width = 0, height = 0;
    let previousLayerConfig = Joi.attempt({}, layersSchema.default());
    const layersConfigs = [];
    while (!isEmpty && depth < maxDepth) {
        isEmpty = true;

        const layerConfig = getLayerConfig(previousLayerConfig, config.layers[depth]);

        const expectedIndividuals = 1 << depth;
        const { width: boxWidth, height: boxHeight } = computeBoxDimensions(layerConfig);
        const currentWidth = expectedIndividuals * boxWidth;
        layersConfigs.push(layerConfig);

        width = Math.max(currentWidth, width);
        height += boxHeight;

        const parentIndividualIds = new Set();
        for(const individualId of individualIds.values()) {
            if(individualId != null) {
                const parentsFamilyId = data.ascendingRelation[individualId];
                if (parentsFamilyId != null) {
                    const parentsFamily = data.families[parentsFamilyId];
                    if(parentsFamily != null) {
                        [parentsFamily.husbandIndividualId, parentsFamily.wifeIndividualId]
                            .filter(id => id != null)
                            .forEach(id => {
                                isEmpty = false;
                                parentIndividualIds.add(id)
                            });
                    }
                }
            }
        }

        if(!isEmpty) {
            depth += 1;
        }

        individualIds = parentIndividualIds;
        previousLayerConfig = layerConfig;
    }
    return { depth, width, height, layersConfigs };
}

/*function computeDescendingProperties(data, config) {
    const maxDepth = config.generations.descending;
    let individualIds = [data.rootIndividualId];
    let isEmpty = false;
    let depth = 0;
    let width = 0, height = 0;
    let previousLayerConfig = layersSchema.default();
    const graph = [];
    while(!isEmpty && depth <= maxDepth) {
        isEmpty = true;

        const layerConfig = getLayerConfig(previousLayerConfig, config.layers[-depth]);

        const childrenIndividualIds = [];
        const graphLayer = [];
        for(let i = 0; i < individualIds.length; i++) {
            const graphIndividual = [];
            const individualId = individualIds[i];
            if(individualId != null) {
                const children = data.descendingRelation[individualId];
                for(const [familyId, childrenList] of Object.entries(children)) {
                    for(const childId of childrenList) {
                        isEmpty = false;
                        graphIndividual.push(i);
                        childrenIndividualIds.push(childId);
                    }
                }
            }
            graphLayer.push(graphIndividual);
        }
        graph.push(graphLayer);


        if(!isEmpty) {
            depth += 1;
        }
        individualIds = childrenIndividualIds;
        previousLayerConfig = layerConfig;
    }

    // TODO graph
}*/

export async function drawRectangle(inputData, inputConfig = {}, ref = null) {
    const data = Joi.attempt(inputData, dataSchema);
    const config = Joi.attempt(inputConfig, configSchema);

    //computeDescendingProperties(data, config);return; // FIXME remove
    const { depth, width, height, layersConfigs } = computeAscendingProperties(data, config);

    const realWidth = 2 * config.margin.sides + width;
    const realHeight = config.margin.top + config.margin.bottom + height;

    const svg = createSVG({
        viewBox: `0 0 ${realWidth} ${realHeight}`,
        ...config.style,
    });

    const allTexts = [];
    let boxY = realHeight - config.margin.bottom;

    let individualIds = [data.rootIndividualId];
    for (let i = 0; i < depth; i++) {
        const layerConfig = layersConfigs[i];

        const totalExpectedIndividuals = 1 << i;
        const parentIndividualIds = [];

        const { height: boxHeight } = computeBoxDimensions(layerConfig);
        const boxWidth = width / totalExpectedIndividuals;
        const textLength = boxWidth - 2 * layerConfig.padding.sides;
        boxY -= boxHeight;

        for (let j = 0; j < totalExpectedIndividuals; j++) {
            const individualId = individualIds[j];
            const individual = data.individuals[individualId];
            if (individualId != null && individual != null) {
                const parentsFamilyId = data.ascendingRelation[individualId];
                const parentsFamily = data.families[parentsFamilyId];
                if (parentsFamilyId != null && parentsFamily != null) {
                    parentIndividualIds.push(parentsFamily.husbandIndividualId, parentsFamily.wifeIndividualId);
                } else {
                    parentIndividualIds.push(undefined, undefined);
                }

                const boxX = config.margin.sides + j * boxWidth;

                const rect = createElement('rect', {
                    x: boxX,
                    y: boxY,
                    width: boxWidth,
                    height: boxHeight,
                    fill: 'none',
                    stroke: 'black',
                    strokeWidth: 1,
                });

                const apiData = {
                    surname: individual.surname,
                    given_name: individual.givenName,
                }

                const texts = layerConfig.texts;
                for (let k = 0; k < texts.length; k++) {
                    const textData = texts[k];
                    const text = createElement('text', {
                        x: boxX + boxWidth / 2,
                        y: boxY + layerConfig.padding.top + k * (layerConfig.padding.textSpacing + layerConfig.textSize) + layerConfig.textSize / 2,
                        'dominant-baseline': 'middle',
                        'text-anchor': 'middle',
                        'font-size': layerConfig.textSize,
                    });
                    text.textContent = apiData[textData.value]; // TODO function

                    allTexts.push([text, layerConfig.textSize, textLength]);

                    svg.append(text); // TODO reorder elements
                }

                svg.append(rect);
            } else {
                parentIndividualIds.push(undefined, undefined);
            }
        }

        individualIds = parentIndividualIds;
    }

    if(ref) {
        ref.innerHTML = ''; // Clear DOM
        ref.append(svg);
    }

    // The following won't work if `ref` is `null`
    allTexts.forEach(([textElement, fontSize, fitTextLength]) => {
        adaptTextSize(textElement, fontSize, fitTextLength);
    });

    return svg;
}
