export const reportInteraction = ({
    name,
    event,
    extend = null,
    type = "click",
}) => {
    try {
        const params: any = {
            subtype: type,
            name: `${name}_${event}`,
            module: "octo",
            project: "designcloud",
            platform: 1,
        };
        extend && (params.extend = extend);
        fetch('/mock/report/interaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        }).catch(() => {})
    } catch (error) {
        console.warn("dc-report error: ", error)
    }
}