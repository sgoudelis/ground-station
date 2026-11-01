/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useId, useRef} from 'react';
import {Circle} from 'react-leaflet';

const svgNamespace = 'http://www.w3.org/2000/svg';

export default function VisibilityCircle({label, ...props}) {
    const circleRef = useRef(null);
    const pathId = `packet-visibility-${useId()}`;

    useEffect(() => {
        const path = circleRef.current.getElement();
        const text = document.createElementNS(svgNamespace, 'text');
        const textPath = document.createElementNS(svgNamespace, 'textPath');
        path.id = pathId;
        text.setAttribute('class', 'packet-visibility-label');
        text.setAttribute('dy', '-5');
        textPath.setAttribute('href', `#${pathId}`);
        // Leaflet draws its lower semicircle from left to right. Centering on
        // that arc keeps the text upright and follows the exact rendered ring.
        textPath.setAttribute('startOffset', '25%');
        textPath.setAttribute('text-anchor', 'middle');
        textPath.textContent = label;
        text.appendChild(textPath);
        path.parentNode.appendChild(text);

        // Referencing Leaflet's own path also follows zoom and radius changes
        // without a second projection or any viewport movement.
        return () => {
            text.remove();
            path.removeAttribute('id');
        };
    }, [label, pathId]);

    return <Circle ref={circleRef} {...props} />;
}
